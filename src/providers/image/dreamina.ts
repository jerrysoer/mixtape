import { execFileSync } from "node:child_process";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MixtapeError, out } from "../../lib/io.js";
import { exec } from "../../media/exec.js";
import type { Budget } from "../../render/budget.js";
import { enoughClip } from "../../render/motion.js";
import type { ClipJob, StillJob } from "../../render/plan.js";

/**
 * Dreamina stills and Seedance clips through the `dreamina-canvas` CLI (pattern from showrun's
 * dreamina_batch.py): every node/update/submit id is saved BEFORE its side effect so a rerun never
 * double-bills; nodes run one per call (group runs once returned another node's picture,
 * 2026-11-06); every run reserves the server-quoted credits in the approved budget first.
 * Clips (`clip_NN`) live on the same canvas as the stills, start from the uploaded locked still
 * (m2v, first frame) and download to clips/<id>.mp4.
 */

export const MODEL = "seedream_5.0_pro";

/** Length of a downloaded clip (s) by ffprobe; 0 when it can't be read. */
function fileSeconds(file: string): number {
  try {
    const n = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file], { encoding: "utf8", timeout: 15_000 }).trim());
    return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0;
  } catch {
    return 0;
  }
}

interface NodeState {
  nodeId: string;
  updateId: string;
  /** "still" (default) or "clip": decides the download folder and extension. */
  kind?: "still" | "clip";
  saved?: boolean;
  quote?: number;
  submitId?: string;
  accepted?: boolean;
  status?: string;
  resourceId?: string;
  file?: string;
  /** stillHash of the job this node generates (plan.ts). */
  hash?: string;
  /** Dreamina error code when generation failed. */
  failed?: string;
  /** Clips: clipBase (what it shows) and the seconds it was made with. */
  base?: string;
  seconds?: number;
}

export interface DreaminaState {
  projectId?: string;
  projectCreated?: boolean;
  nodes: Record<string, NodeState>;
  /** Retired nodes (changed prompt or failed), kept for the record; never reused. */
  history?: (NodeState & { id: string; retiredAt: string; why: string })[];
  /** Uploaded local files (stills, audio) by content hash → Dreamina resource id. */
  uploads?: Record<string, string>;
}

export interface DreaminaOptions {
  dir: string;
  bin?: string;
  ratio?: string;
  resolution?: string;
  /** Seedance output size (480p | 720p). */
  videoResolution?: string;
  pollSeconds?: number;
  timeoutSeconds?: number;
}

type Json = { ok?: boolean; data?: Record<string, unknown>; error?: { code?: string; message?: string } };

export class Dreamina {
  private readonly stateFile: string;
  readonly state: DreaminaState;
  private readonly bin: string;

  constructor(private readonly o: DreaminaOptions) {
    this.stateFile = join(o.dir, "dreamina.json");
    this.bin = o.bin ?? "dreamina-canvas";
    this.state = existsSync(this.stateFile) ? (JSON.parse(readFileSync(this.stateFile, "utf8")) as DreaminaState) : { nodes: {} };
  }

  private save(): void {
    writeFileSync(this.stateFile, JSON.stringify(this.state, null, 2) + "\n");
  }

  private async cli(args: string[], ok = true): Promise<Json> {
    let raw: string;
    try {
      raw = (await exec(this.bin, [...args, "--format", "json", "--non-interactive"], { timeoutMs: 180_000 })).stdout;
    } catch (e) {
      if (!ok) return { ok: false };
      throw e instanceof MixtapeError ? e : new MixtapeError(`dreamina-canvas ${args.slice(0, 2).join(" ")} failed.`);
    }
    let d: Json;
    try {
      d = JSON.parse(raw) as Json;
    } catch {
      d = { ok: false, error: { message: "unreadable reply" } };
    }
    if (ok && !d.ok) throw new MixtapeError(`dreamina-canvas ${args.slice(0, 2).join(" ")} refused: ${d.error?.code ?? ""} ${d.error?.message ?? ""}`.trim());
    return d;
  }

  async ensureProject(title: string): Promise<string> {
    if (!this.state.projectId) {
      this.state.projectId = randomUUID();
      this.save();
    }
    if (!this.state.projectCreated) {
      await this.cli(["canvas", "create", title.slice(0, 80), "--project-id", this.state.projectId]);
      this.state.projectCreated = true;
      this.save();
    }
    return this.state.projectId;
  }

  private node(id: string): NodeState {
    let n = this.state.nodes[id];
    if (!n) {
      n = { nodeId: `node_${randomBytes(5).toString("hex")}`, updateId: randomUUID() };
      this.state.nodes[id] = n;
      this.save();
    }
    return n;
  }

  /**
   * Can this job's existing still be used as is? Yes when it was downloaded, didn't fail, and either
   * its prompt hash is unchanged or it is QC-locked (passed QC: kept even if the planner's wording moved).
   */
  reusable(job: Pick<StillJob, "id" | "hash">, locked: boolean): boolean {
    const n = this.state.nodes[job.id];
    if (!n?.file || !existsSync(n.file) || n.failed) return false;
    return locked || n.hash === job.hash;
  }

  /**
   * Paid for but not downloaded yet (accepted, not failed, same prompt): counts as on file in a quote
   * (0 cr), so a run that handed back while Dreamina was still rendering resumes without a new approval.
   */
  paid(job: Pick<StillJob, "id" | "hash">): boolean {
    const n = this.state.nodes[job.id];
    return Boolean(n?.accepted && !n.failed && n.hash === job.hash && !(n.file && existsSync(n.file)));
  }

  /**
   * Can this clip be used as is? As `reusable`, or when it shows the same thing (base) and is long
   * enough for the window now needed (within CLIP_SHORT_TOLERANCE: the cut slows and holds it): a
   * narration rewrite that moves the cut points never re-buys a clip whose picture is unchanged.
   */
  reusableClip(job: Pick<ClipJob, "id" | "hash" | "base" | "seconds">, locked: boolean): boolean {
    if (this.reusable(job, locked)) return true;
    const n = this.state.nodes[job.id];
    if (!n?.file || !existsSync(n.file) || n.failed) return false;
    return n.base === job.base && enoughClip(n.seconds ?? 0, job.seconds);
  }

  /**
   * Clip nodes made before base/seconds were stored: the base comes from the plan that made them
   * (same hash); the length comes from the downloaded file itself, which is always true.
   */
  backfillClips(clips: Pick<ClipJob, "id" | "hash" | "base" | "seconds">[]): void {
    let changed = false;
    for (const c of clips) {
      const n = this.state.nodes[c.id];
      if (!n) continue;
      if (n.hash === c.hash && n.base === undefined) {
        n.base = c.base;
        changed = true;
      }
      if (n.seconds === undefined && n.file && existsSync(n.file)) {
        const s = fileSeconds(n.file);
        if (s > 0) {
          n.seconds = s;
          changed = true;
        }
      }
    }
    if (changed) this.save();
  }

  /** How many times this job was retired after a QC or sync fail (the one-retake rule for clips). */
  qcRetakes(id: string): number {
    return (this.state.history ?? []).filter((h) => h.id === id && (h.why === "QC fail" || h.why.startsWith("failed (sync"))).length;
  }

  /** Mark a downloaded job as failed (e.g. the sync gate): never reused, retaken as a fresh node. */
  fail(id: string, why: string): void {
    const n = this.state.nodes[id];
    if (!n) return;
    n.failed = why;
    this.save();
  }

  /** Nodes made before hashes were stored get the hash of the plan that made them (its plan.json). */
  backfill(jobsThatMadeThem: Pick<StillJob, "id" | "hash">[]): void {
    let changed = false;
    for (const j of jobsThatMadeThem) {
      const n = this.state.nodes[j.id];
      if (n && n.hash === undefined) {
        n.hash = j.hash;
        changed = true;
      }
    }
    if (changed) this.save();
  }

  /** Move a node to history; the job gets a fresh node (and a fresh bill) next time it is saved. */
  retire(id: string, why: string): void {
    const n = this.state.nodes[id];
    if (!n) return;
    (this.state.history ??= []).push({ ...n, id, retiredAt: new Date().toISOString(), why });
    this.state.nodes = Object.fromEntries(Object.entries(this.state.nodes).filter(([k]) => k !== id));
    this.save();
  }

  /** Create the node on the canvas (no spend). Refs point at upstream nodes so edges are kept. */
  async saveNode(job: StillJob, title: string): Promise<void> {
    const P = this.state.projectId ?? (await this.ensureProject(title));
    const prev = this.state.nodes[job.id];
    if (prev?.failed) this.retire(job.id, `failed (${prev.failed})`);
    else if (prev?.hash !== undefined && prev.hash !== job.hash) this.retire(job.id, "prompt changed");
    const n = this.node(job.id);
    if (n.saved) return;
    n.hash = job.hash;
    const refs = job.refs.map((r) => this.node(r).nodeId);
    const prompt = refs.length ? `Reference images: ${refs.map((r, i) => `{{node:${r}}} (${job.refs[i] ?? ""})`).join(", ")}. ${job.prompt}` : job.prompt;
    const args = [
      "node", "create", "image", "--project-id", P, "--node-id", n.nodeId, "--update-id", n.updateId, "--title", `${title} ${job.id}`,
      "--mode", refs.length ? "i2i" : "t2i", "--model", MODEL, "--ratio", this.o.ratio ?? "9:16", "--resolution", this.o.resolution ?? "2K", "--count", "1",
      "--prompt", prompt, ...refs.flatMap((r) => ["--ref", `node:${r}`]),
    ];
    await this.cli(args);
    n.saved = true;
    this.save();
  }

  /** Upload a local file (a locked still, a voice line) once; the same bytes reuse the same resource id. */
  async upload(file: string, type: "image" | "audio"): Promise<string> {
    const key = createHash("sha1").update(readFileSync(file)).digest("hex");
    const have = this.state.uploads?.[key];
    if (have) return have;
    const P = this.state.projectId ?? "";
    const d = await this.cli(["resource", "upload", "--project-id", P, "--file", file, "--type", type, "--resource-id", randomUUID()]);
    const id = d.data?.["resourceId"];
    if (typeof id !== "string" || !id) throw new MixtapeError(`Dreamina gave no resource id for ${file}.`);
    (this.state.uploads ??= {})[key] = id;
    this.save();
    return id;
  }

  /**
   * Create a Seedance clip node (no spend) from a locked still: m2v with the still as the first
   * frame reference. Never `--run` on create (showrun rule); the run is a separate, budgeted call.
   */
  async saveClipNode(job: ClipJob, title: string, stillFile: string): Promise<void> {
    const P = this.state.projectId ?? (await this.ensureProject(title));
    const prev = this.state.nodes[job.id];
    if (prev?.failed) this.retire(job.id, `failed (${prev.failed})`);
    else if (prev?.hash !== undefined && prev.hash !== job.hash) this.retire(job.id, "prompt changed");
    const n = this.node(job.id);
    n.kind = "clip";
    if (n.saved) return;
    n.hash = job.hash;
    n.base = job.base;
    n.seconds = job.seconds;
    const still = await this.upload(stillFile, "image");
    // A speaking clip gets its tight voice line as an audio ref (rule 0); {{audio}} in the prompt becomes that resource.
    const audio = job.audio ? await this.upload(job.audio, "audio") : null;
    const prompt = `First frame: {{res:${still}}} (${job.still}). ${audio ? job.prompt.replace("{{audio}}", `{{res:${audio}}}`) : job.prompt}`;
    await this.cli([
      "node", "create", "video", "--project-id", P, "--node-id", n.nodeId, "--update-id", n.updateId, "--title", `${title} ${job.id}`,
      "--mode", "m2v", "--model", job.model, "--ratio", this.o.ratio ?? "9:16", "--resolution", this.o.videoResolution ?? "720p", "--duration", String(job.seconds), "--count", "1",
      "--prompt", prompt, "--ref", `res:${still}`, ...(audio ? ["--ref", `res:${audio}`] : []),
    ]);
    n.saved = true;
    this.save();
  }

  /**
   * Server quote for one node (no spend). A shot whose reference nodes haven't run yet quotes 0
   * (live, 2026-11-06), so a 0 is returned but never cached: the node is re-quoted before it runs.
   */
  async quote(jobId: string): Promise<number> {
    const n = this.node(jobId);
    if (n.quote === undefined || n.quote <= 0) {
      const d = await this.cli(["node", "quote", "--project-id", this.state.projectId ?? "", "--node-id", n.nodeId]);
      const q = Number(d.data?.["totalMaxCredits"]);
      if (!Number.isFinite(q)) throw new MixtapeError(`Dreamina gave no quote for ${jobId}.`);
      if (q <= 0) {
        delete n.quote;
        this.save();
        return 0;
      }
      n.quote = q;
      this.save();
    }
    return n.quote;
  }

  /** Confirm + run one node inside the approved budget. */
  async run(jobId: string, budget: Budget): Promise<void> {
    const n = this.node(jobId);
    if (n.accepted) return;
    const q = await this.quote(jobId);
    if (q <= 0) throw new MixtapeError(`Dreamina can't price ${jobId} yet (its reference stills may not be finished). Nothing was run; rerun the same command.`);
    budget.reserve(`${n.kind ?? "still"} ${jobId}`, q, 0);
    n.submitId = n.submitId ?? randomUUID();
    this.save();
    const P = this.state.projectId ?? "";
    const tok = (await this.cli(["node", "confirm", "--project-id", P, "--credit-ceiling", String(q), "--node-id", n.nodeId])).data?.["creditConfirmationToken"];
    if (typeof tok !== "string") throw new MixtapeError(`Dreamina gave no confirmation token for ${jobId}.`);
    await this.cli(["node", "run", "--project-id", P, "--credit-token", tok, "--node-id", n.nodeId, "--submit-id", n.submitId]);
    n.accepted = true;
    this.save();
  }

  private async show(jobId: string): Promise<{ status: string; resourceId?: string; error?: string }> {
    const n = this.node(jobId);
    const d = await this.cli(["node", "show", "--project-id", this.state.projectId ?? "", "--node-id", n.nodeId], false);
    const node = ((d.data?.["nodes"] as { node?: { status?: string; resources?: { resourceId?: string; status?: string; errorCode?: unknown }[] } }[] | undefined)?.[0]?.node) ?? {};
    const res = node.resources?.[0];
    const bad = node.resources?.find((r) => r.status === "failed");
    const failed = node.status === "failed" || Boolean(bad);
    return {
      status: failed ? "failed" : (node.status ?? "unknown"),
      ...(res?.resourceId ? { resourceId: res.resourceId } : {}),
      ...(failed ? { error: String(bad?.errorCode ?? "unknown") } : {}),
    };
  }

  /**
   * Wait for nodes to finish and download them (stills/<id>.png, clips/<id>.mp4). Keeps going past
   * failures and reports them at the end; with `tolerate`, failures are recorded and the rest returned.
   */
  async waitAndFetch(jobIds: string[], tolerate = false): Promise<Record<string, string>> {
    const stills = join(this.o.dir, "stills");
    const clips = join(this.o.dir, "clips");
    mkdirSync(stills, { recursive: true });
    mkdirSync(clips, { recursive: true });
    const deadline = Date.now() + (this.o.timeoutSeconds ?? 1800) * 1000;
    const files: Record<string, string> = {};
    let left = jobIds.filter((id) => {
      const f = this.state.nodes[id]?.file;
      if (f && existsSync(f)) files[id] = f;
      return !(f && existsSync(f));
    });
    const failures: string[] = [];
    while (left.length) {
      for (const id of [...left]) {
        const s = await this.show(id);
        const n = this.node(id);
        n.status = s.status;
        if (s.status === "failed") {
          n.failed = s.error ?? "unknown";
          failures.push(`${id} (error ${n.failed})`);
          left = left.filter((x) => x !== id);
          this.save();
          continue;
        }
        if (s.status === "success" && s.resourceId) {
          const file = n.kind === "clip" ? join(clips, `${id}.mp4`) : join(stills, `${id}.png`);
          // dreamina-canvas refuses to overwrite (cli.invalid_download_output), so a retake clears the old still first.
          rmSync(file, { force: true });
          await this.cli(["resource", "download", s.resourceId, "--project-id", this.state.projectId ?? "", "--output", file]);
          n.resourceId = s.resourceId;
          n.file = file;
          files[id] = file;
          left = left.filter((x) => x !== id);
        }
        this.save();
      }
      if (!left.length) break;
      if (Date.now() > deadline) throw new MixtapeError(`Still waiting on ${left.join(", ")}. Rerun the same command later; nothing is billed twice.`);
      out(`  ${left.length} job(s) generating…`);
      await new Promise((r) => setTimeout(r, (this.o.pollSeconds ?? 20) * 1000));
    }
    if (failures.length && !tolerate) throw new MixtapeError(`Dreamina failed on ${failures.join(", ")}. The other stills are downloaded; spent credits are in the spend ledger. A retake gets a fresh node and its own quote.`);
    if (failures.length) out(`  warn: Dreamina failed on ${failures.join(", ")}; those shots fall back to their stills.`);
    return files;
  }
}
