import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { z } from "zod";
import { briefFor, loadEpisodes, pickRows, type Episode } from "../batch/episodes.js";
import { mergeValidation, type ProducedRow } from "../batch/validation.js";
import { loadConfig, type Config } from "../config.js";
import { MixtapeError, out } from "../lib/io.js";
import { projectPaths } from "../lib/jobs.js";
import { scriptSchema } from "../schema/script.js";
import { pressFinish, pressPrep } from "./press.js";
import { renderPlan, renderQcFinish, renderRun, totalSpent } from "./render.js";

/**
 * `mixtape batch`: an episode file → one press job per row → N scripts → ONE pack quote →
 * renders → QC → validation.csv. The pack quote is the sum of each row's render quote and its id
 * is a hash of those quote ids, so approving the pack approves exactly those N quotes and nothing
 * else. Every row is still held to its own approval, ledger and ceiling. Nothing is ever posted.
 */

const NAME = /^[a-z0-9][a-z0-9-]{2,63}$/;

export interface BatchOptions {
  name?: string;
  rows?: string;
  finish?: boolean;
  approve?: string;
  run?: boolean;
  qcFinish?: boolean;
  /** Stills + Ken Burns only for every row (no clip stage). */
  still?: boolean;
}

const rowSchema = z.object({
  ep: z.number(),
  title: z.string(),
  year: z.number(),
  format: z.string(),
  product: z.string(),
  hook: z.string(),
  slug: z.string(),
  /** Hash of the row's episode fields; a changed row is pressed again. */
  key: z.string(),
  stage: z.enum(["press", "script"]),
  pressJob: z.string().nullable(),
  script: z.string().nullable(),
  errors: z.array(z.string()),
  status: z.string().nullable(),
});
type BatchRow = z.infer<typeof rowSchema>;

const packSchema = z.object({
  id: z.string(),
  credits: z.number(),
  usd: z.number(),
  items: z.array(z.object({ slug: z.string(), quoteId: z.string(), credits: z.number(), usd: z.number() })),
});
type Pack = z.infer<typeof packSchema>;

const batchSchema = z.object({ name: z.string(), file: z.string(), created: z.string(), rows: z.array(rowSchema), pack: packSchema.nullable(), still: z.boolean().optional() });
type Batch = z.infer<typeof batchSchema>;

export function batchDir(root: string, name: string): string {
  if (!NAME.test(name)) throw new MixtapeError(`"${name}" is not a usable batch name (lowercase letters, digits, dashes; 3-64 chars).`);
  return join(root, "renders", "_batches", name);
}

function load(root: string, name: string): Batch {
  const f = join(batchDir(root, name), "batch.json");
  if (!existsSync(f)) throw new MixtapeError(`No batch "${name}". Start one with  mixtape batch <episodes.csv> --name ${name}`);
  return batchSchema.parse(JSON.parse(readFileSync(f, "utf8")));
}

function save(root: string, b: Batch): void {
  const dir = batchDir(root, b.name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "batch.json"), JSON.stringify(b, null, 2) + "\n");
}

/** Rows store paths relative to the project root; render resolves from the cwd, so always pass it absolute. */
function scriptPath(root: string, r: BatchRow): string {
  if (!r.script) throw new MixtapeError(`ep ${r.ep} has no script yet.`);
  return resolve(root, r.script);
}

function rowKey(e: Episode): string {
  return createHash("sha256").update(JSON.stringify([e.format, e.hook, briefFor(e), e.script, e.slug])).digest("hex").slice(0, 12);
}

/** Pack id: one hash over every row's slug and quote id, in order. */
export function packId(items: Pack["items"]): string {
  return `p-${createHash("sha256").update(JSON.stringify(items.map((i) => [i.slug, i.quoteId]))).digest("hex").slice(0, 10)}`;
}

export async function batchPrep(file: string, opts: BatchOptions, root: string = process.cwd()): Promise<Batch> {
  const eps = pickRows(loadEpisodes(resolve(root, file)), opts.rows);
  const name = opts.name ?? basename(file).replace(/\.[a-z]+$/i, "").toLowerCase().replace(/[^a-z0-9-]+/g, "-");
  const dir = batchDir(root, name);
  const prev = existsSync(join(dir, "batch.json")) ? load(root, name) : null;
  const p = projectPaths(root);
  const rows: BatchRow[] = [];
  for (const e of eps) {
    const key = rowKey(e);
    const base = { ep: e.ep, title: e.title, year: e.year, format: e.format, product: e.product, hook: e.hook, slug: e.slug, key, errors: [] as string[], status: null };
    const kept = prev?.rows.find((r) => r.ep === e.ep && r.key === key);
    if (kept) {
      rows.push(kept);
      continue;
    }
    if (e.script) {
      const s = resolve(root, e.script);
      if (!existsSync(s)) rows.push({ ...base, stage: "press", pressJob: null, script: null, errors: [`script ${e.script} not found`] });
      else rows.push({ ...base, stage: "script", pressJob: null, script: relative(root, s) });
      continue;
    }
    try {
      const { id } = await pressPrep(e.format, briefFor(e), { hookLine: e.hook, quiet: true }, p);
      rows.push({ ...base, stage: "press", pressJob: id, script: null });
    } catch (err) {
      rows.push({ ...base, stage: "press", pressJob: null, script: null, errors: [err instanceof Error ? err.message : String(err)] });
    }
  }
  const b: Batch = { name, file: relative(root, resolve(root, file)), created: prev?.created ?? new Date().toISOString(), rows, pack: null, ...(opts.still || prev?.still ? { still: true } : {}) };
  save(root, b);
  return b;
}

/** Validate answered press jobs; once every row has a script, quote the pack. */
export async function batchFinish(name: string, root: string = process.cwd(), config: Config = loadConfig(root)): Promise<Batch> {
  const b = load(root, name);
  const p = projectPaths(root);
  for (const r of b.rows) {
    if (r.stage !== "press" || !r.pressJob) continue;
    if (!existsSync(join(p.jobs("press"), r.pressJob, "answer.json"))) {
      r.errors = [`waiting for .cache/press/${r.pressJob}/answer.json`];
      continue;
    }
    const f = pressFinish(r.pressJob, {}, p);
    if (f.ok && f.outPath) {
      r.stage = "script";
      r.script = relative(root, f.outPath);
      r.errors = [];
    } else r.errors = f.errors;
  }
  b.pack = null;
  if (b.rows.every((r) => r.stage === "script" && r.script)) b.pack = await quotePack(b, root, config, null);
  save(root, b);
  if (b.pack) writeFileSync(join(batchDir(root, name), "PACK.md"), packMarkdown(b, b.pack));
  return b;
}

/**
 * One pack quote over every row's current render quote. In motion mode a row quotes its stills first
 * and, once its stills are QC-locked, its clips: the same `--finish` → `--approve` → `--run` →
 * `--qc-finish` loop runs twice per pack (stills, then clips). `--still` on the batch keeps rows at stills.
 */
async function quotePack(b: Batch, root: string, config: Config, approve: Map<string, string> | null): Promise<Pack> {
  const items: Pack["items"] = [];
  for (const r of b.rows) {
    const q = await renderPlan(scriptPath(root, r), { slug: r.slug, ...(b.still ? { still: true } : {}), dryRun: false, ...(approve ? { approve: approve.get(r.slug) ?? "" } : {}) }, root, config);
    if (q.quote.overCeiling) throw new MixtapeError(`ep ${r.ep} (${r.slug}) is over the per-render ceiling at $${q.quote.usd.toFixed(2)}. Nothing was approved.`);
    items.push({ slug: r.slug, quoteId: q.quote.id, credits: q.quote.credits, usd: q.quote.usd });
  }
  return { id: packId(items), credits: items.reduce((a, i) => a + i.credits, 0), usd: Math.round(items.reduce((a, i) => a + i.usd, 0) * 100) / 100, items };
}

function packMarkdown(b: Batch, pack: Pack): string {
  const lines = [
    `# Pack quote ${pack.id}: ${b.name}`,
    "",
    "Estimate. Every row keeps its own approval, spend ledger and ceiling; Dreamina's server quote is checked again before anything runs.",
    "",
    "| ep | title | format | render | quote | credits | usd |",
    "|---|---|---|---|---|---|---|",
    ...b.rows.map((r, i) => {
      const it = pack.items[i];
      return `| ${r.ep} | ${r.title} | ${r.format} | renders/${r.slug}/QUOTE.md | ${it?.quoteId ?? ""} | ${it?.credits ?? 0} | $${(it?.usd ?? 0).toFixed(2)} |`;
    }),
    `| | **total** | | | | **${pack.credits}** | **$${pack.usd.toFixed(2)}** |`,
    "",
    `Approve exactly this pack:  mixtape batch ${b.name} --approve ${pack.id}`,
    "",
  ];
  return lines.join("\n");
}

/** Approve the pack only if every row still quotes exactly what the pack id covers; then write each row's approval. */
export async function batchApprove(name: string, id: string, root: string = process.cwd(), config: Config = loadConfig(root)): Promise<Pack> {
  const b = load(root, name);
  if (!b.rows.every((r) => r.stage === "script")) throw new MixtapeError("Not every row has a script yet. Run  mixtape batch " + name + " --finish  first.");
  const now = await quotePack(b, root, config, null);
  if (now.id !== id) throw new MixtapeError(`Pack ${id} does not match the current pack quote ${now.id} (a script or price changed). Read PACK.md again. Nothing was approved.`);
  await quotePack(b, root, config, new Map(now.items.map((i) => [i.slug, i.quoteId])));
  b.pack = now;
  save(root, b);
  writeFileSync(join(batchDir(root, name), "approval.json"), JSON.stringify({ packId: id, approvedAt: new Date().toISOString(), credits: now.credits, usd: now.usd }, null, 2) + "\n");
  return now;
}

/** Run every approved row; one row failing never stops the others. */
export async function batchRun(name: string, root: string = process.cwd(), config: Config = loadConfig(root)): Promise<Batch> {
  const b = load(root, name);
  if (!existsSync(join(batchDir(root, name), "approval.json"))) throw new MixtapeError(`Pack not approved. Read renders/_batches/${name}/PACK.md, then  mixtape batch ${name} --approve <pack-id>`);
  for (const r of b.rows) {
    out(`\nep ${r.ep} ${r.slug}`);
    try {
      const res = await renderRun(scriptPath(root, r), { slug: r.slug, ...(b.still ? { still: true } : {}) }, root, config);
      r.status = res.stage === "voice" ? "narration recorded (clip quote next: --finish)" : "awaiting QC";
      r.errors = [];
      out(`  cut ${relative(root, res.out)} (${res.seconds.toFixed(1)} s), spent $${res.spent.usd.toFixed(2)}; QC: ${relative(root, res.qcPrompt)}`);
    } catch (err) {
      r.status = "run failed";
      r.errors = [err instanceof Error ? err.message : String(err)];
      out(`  failed: ${r.errors[0]}`);
    }
    save(root, b);
  }
  return b;
}

function producedRow(r: BatchRow, root: string): ProducedRow {
  const dir = join(root, "renders", r.slug);
  const script = scriptSchema.parse(JSON.parse(readFileSync(scriptPath(root, r), "utf8")));
  const render = JSON.parse(readFileSync(join(dir, "render.json"), "utf8")) as { seconds?: number };
  return {
    ep: r.ep,
    title: r.title,
    year: r.year,
    format: r.format,
    product: r.product,
    hook_text: script.hook.line,
    length_s: render.seconds ?? 0,
    source_kind: script.structure.source.kind,
    cost_usd: totalSpent(dir).usd,
    render_version: readdirSync(dir).filter((f) => /^spend-.*\.json$/.test(f)).length,
  };
}

/** Record QC for every row that has an answer; delivered rows go into renders/validation.csv. */
export function batchQcFinish(name: string, root: string = process.cwd()): { batch: Batch; delivered: number; csv: string } {
  const b = load(root, name);
  const delivered: ProducedRow[] = [];
  for (const r of b.rows) {
    const dir = join(root, "renders", r.slug);
    if (!existsSync(join(dir, "render.json"))) continue;
    if (!existsSync(join(dir, "qc", "answer.json"))) {
      r.status = "awaiting QC";
      continue;
    }
    const q = renderQcFinish(scriptPath(root, r), { slug: r.slug }, root);
    // Motion mode: a stills pass only locks the stills; the row is delivered after its clip QC.
    const locked = q.passed && q.stage === "stills" && q.mode === "motion" && !b.still;
    r.status = locked ? "stills locked (clip quote next: --finish)" : q.passed ? "delivered" : "QC failed";
    r.errors = q.failures;
    if (q.passed && !locked) delivered.push(producedRow(r, root));
  }
  save(root, b);
  const csv = join(root, "renders", "validation.csv");
  writeFileSync(csv, mergeValidation(existsSync(csv) ? readFileSync(csv, "utf8") : null, delivered));
  return { batch: b, delivered: delivered.length, csv };
}

function printRows(b: Batch): void {
  for (const r of b.rows) {
    const what = r.status ?? (r.stage === "script" ? `script ${r.script}` : r.pressJob ? `press prompt .cache/press/${r.pressJob}/prompt.md` : "not started");
    out(`  ep ${String(r.ep).padStart(2)} ${r.slug.padEnd(34)} ${what}`);
    for (const e of r.errors) out(`      - ${e}`);
  }
}

export async function batchCommand(target: string | undefined, opts: BatchOptions): Promise<number> {
  const root = process.cwd();
  if (!target) throw new MixtapeError("Give an episode file to start a batch, or a batch name with --finish, --approve, --run or --qc-finish.");
  if (opts.finish) {
    const b = await batchFinish(target, root);
    printRows(b);
    if (!b.pack) {
      out("\nNot every row has a script yet; answer the prompts above and run --finish again.");
      return 1;
    }
    const clipRows = b.rows.filter((r) => existsSync(join(root, "renders", r.slug, "plan.json")) && (JSON.parse(readFileSync(join(root, "renders", r.slug, "plan.json"), "utf8")) as { stage?: string }).stage === "clips").length;
    out(`\npack quote ${b.pack.id}: ${b.pack.items.length} renders${clipRows ? ` (${clipRows} at the clip stage)` : ""}, ${b.pack.credits} cr / $${b.pack.usd.toFixed(2)} (estimate). Nothing billed.`);
    out(`  details: renders/_batches/${b.name}/PACK.md`);
    out(`  approve exactly this pack:  mixtape batch ${b.name} --approve ${b.pack.id}`);
    return 0;
  }
  if (opts.approve) {
    const pack = await batchApprove(target, opts.approve, root);
    out(`Approved pack ${pack.id} (${pack.items.length} renders, max ${pack.credits} cr / $${pack.usd.toFixed(2)}). Nothing billed yet. Run it:  mixtape batch ${target} --run`);
    return 0;
  }
  if (opts.run) {
    const b = await batchRun(target, root);
    out("");
    printRows(b);
    out(`\nQC next: answer each renders/<slug>/qc/prompt.md, then  mixtape batch ${target} --qc-finish`);
    return b.rows.some((r) => r.status === "run failed") ? 1 : 0;
  }
  if (opts.qcFinish) {
    const q = batchQcFinish(target, root);
    printRows(q.batch);
    out(`\n${q.delivered} of ${q.batch.rows.length} delivered; validation log: ${relative(root, q.csv)} (post links and metrics blank until filled).`);
    return q.delivered === q.batch.rows.length ? 0 : 1;
  }
  const b = await batchPrep(target, opts, root);
  out(`batch ${b.name}: ${b.rows.length} episodes from ${b.file}`);
  printRows(b);
  out(`\nNext: answer each press prompt, then  mixtape batch ${b.name} --finish`);
  return 0;
}
