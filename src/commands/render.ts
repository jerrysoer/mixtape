import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { loadConfig, type Config } from "../config.js";
import { auditScript } from "../guard/script.js";
import { MixtapeError, out } from "../lib/io.js";
import { cachedSourceText } from "../lib/jobs.js";
import { exec } from "../media/exec.js";
import { recordEleven, recordSay, takeBody, takeKey, takeText } from "../providers/voice/record.js";
import { Dreamina } from "../providers/image/dreamina.js";
import { placeholderStills } from "../providers/image/placeholder.js";
import { placeholderClips } from "../providers/video/placeholder.js";
import { loadAccount, narratorModel, type Account } from "../render/account.js";
import { buildCut, type ClipSegment } from "../render/assemble.js";
import { Budget } from "../render/budget.js";
import { drawEnvelope, envelopeLeft, grantEnvelope, parseEnvelope, readEnvelope } from "../render/envelope.js";
import { buildClipPlan, clipSeconds } from "../render/motion.js";
import { SPEED_MIN, judgeSync, lineLock, speechSpan, tightRef, type Fit, type Span, type SyncVerdict } from "../render/sync.js";
import { buildPlan, stillHash, type Plan } from "../render/plan.js";
import { consumeVerdict, finishQc, prepareQc, qcVerdicts } from "../render/qc.js";
import { captionChunks, lineCaptions, shotTimes, type ShotTime, type Word } from "../render/timeline.js";
import { approveQuote, buildQuote, type Quote, type Rates } from "../render/quote.js";
import { scriptSchema, type Script } from "../schema/script.js";
import { formatIssues } from "../schema/structure.js";

const MAX_SCRIPT_BYTES = 512 * 1024;
const SLUG = /^[a-z0-9][a-z0-9-]{2,63}$/;
/** Closest `say` setting to the narrator's 2.5 words/s on Jerry's Mac (measured 2026-11-06). */
const SAY_WPM = 110;

export interface RenderOptions {
  slug?: string;
  approve?: string;
  /** Grant this render a spend envelope ("1000cr $1.50"); --run then approves each quote that fits in what is left. */
  approveEnvelope?: string;
  /** Free narration dry run with macOS `say` (default on). */
  dryRun?: boolean;
  /** Paid run (needs approval.json matching the current quote). */
  run?: boolean;
  /** Record QC verdicts from renders/<slug>/qc/answer.json. */
  qcFinish?: boolean;
  /** Download paid stills/clips that finished (no spend). */
  fetch?: boolean;
  /** Stills + Ken Burns only (no Seedance stage), narrated with the still-mode voice model. */
  still?: boolean;
}

/**
 * A free listen-through only. macOS `say` doesn't hold a set pace (-r 150 measured 3.0 words/s,
 * -r 110 about 2.5; DECISIONS), so it gives no timing verdict: timing is checked by the script
 * guard at 2.5 words/s and, in sprint 5, against the recorded narration.
 */
export interface DryRun {
  file: string;
  seconds: number;
  wordsPerSecond: number;
  targetSeconds: number;
}

export interface RenderPlanResult {
  slug: string;
  dir: string;
  plan: Plan;
  quote: Quote;
  dryRun: DryRun | null;
  approved: boolean;
}

export function ratesFrom(config: Config): Rates {
  return {
    creditsPerStill: config.MX_IMAGE_SOURCE === "placeholder" ? 0 : config.MX_CREDITS_PER_STILL,
    creditsPerVideoSec: config.MX_VIDEO_SOURCE === "placeholder" ? 0 : config.MX_CREDITS_PER_VIDEO_SEC,
    creditsPerUsd: config.MX_CREDITS_PER_USD,
    voiceUsdPer1kChars: config.MX_VOICE_SOURCE === "say" ? 0 : config.MX_VOICE_USD_PER_1K_CHARS,
    ceilingUsd: config.MX_MAX_SPEND_PER_RUN,
  };
}

/** `--still` wins over MX_RENDER_MODE. */
export function modeFor(opts: Pick<RenderOptions, "still">, config: Config): Plan["mode"] {
  return opts.still ? "still" : config.MX_RENDER_MODE;
}

export { narratorModel };

function loadScript(file: string): Script {
  const abs = resolve(file);
  if (!existsSync(abs) || !statSync(abs).isFile()) throw new MixtapeError(`No script at ${file}.`);
  if (statSync(abs).size > MAX_SCRIPT_BYTES) throw new MixtapeError("That script file is too large.");
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(abs, "utf8"));
  } catch {
    throw new MixtapeError(`${file} is not valid JSON.`);
  }
  const r = scriptSchema.safeParse(json);
  if (!r.success) throw new MixtapeError(`${file} is not a valid script.json:\n  ${formatIssues(r.error).join("\n  ")}`);
  return r.data;
}

async function voiceDryRun(plan: Plan, dir: string): Promise<DryRun | null> {
  if (plan.voice.mode === "none") return null;
  const dry = join(dir, "dryrun");
  mkdirSync(dry, { recursive: true });
  const textFile = join(dry, "vo.txt");
  writeFileSync(textFile, plan.voice.text);
  const audio = join(dry, "vo.aiff");
  // -f reads the text from a file, so no script line is ever parsed as a flag.
  await exec("say", ["-r", String(SAY_WPM), "-o", audio, "-f", textFile], { timeoutMs: 60_000 });
  const seconds = await audioSeconds(audio);
  const wordCount = plan.voice.text.split(/\s+/).filter(Boolean).length;
  return { file: audio, seconds, wordsPerSecond: Math.round((wordCount / seconds) * 100) / 100, targetSeconds: plan.duration_s };
}

/** ffprobe on an audio-only file (probe() requires video). */
async function audioSeconds(file: string): Promise<number> {
  const { stdout } = await exec("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file], { timeoutMs: 15_000 });
  return Math.round(Number(stdout.trim()) * 100) / 100;
}

function quoteMarkdown(plan: Plan, q: Quote, dry: DryRun | null, scriptRef: string): string {
  const usd = (n: number) => `$${n.toFixed(2)}`;
  const rows = q.items.map((i) => `| ${i.label} | ${i.units} ${i.unitName}${i.units === 1 || i.unitName.endsWith("s") ? "" : "s"} | ${i.credits || "-"} | ${usd(i.usd)} |`).join("\n");
  const stills = plan.stills.map((j) => `### ${j.id} (${j.kind})${j.refs.length ? ` · refs: ${j.refs.join(", ")}` : ""}\n\n${j.prompt}`).join("\n\n");
  const clips = plan.clips.map((c) => `### ${c.id} · ${c.seconds} s · ${c.model} · from ${c.still}${c.speaker ? ` · speaker ${c.speaker}` : ""}\n\n${c.prompt}`).join("\n\n");
  const stage =
    plan.stage === "clips"
      ? "motion stage: Seedance clips on the QC-locked stills"
      : plan.stage === "voice"
        ? "voice stage: records the narration first; the stills quote follows, cut to the read"
        : plan.mode === "motion"
          ? "stills stage of a motion render: the clip quote follows once every still passes QC"
          : "stills render (--still)";
  const length = plan.read_s !== undefined ? `${plan.read_s.toFixed(1)} s (the recorded read; script target ${plan.target_s} s)` : `${plan.duration_s} s`;
  return `# Render quote ${q.id}

Script: \`${scriptRef}\` · slug \`${plan.slug}\` · ${length} · ${plan.aspect} · ${stage}

**This is an estimate** at ${q.rates.creditsPerStill} credits per still, ${q.rates.creditsPerVideoSec} credits per clip second, $1 = ${q.rates.creditsPerUsd} credits, narration $${q.rates.voiceUsdPer1kChars}/1k chars.
Before running, the run step gets Dreamina's server quote and refuses if it is higher than this approval.

| Item | Units | Credits | USD |
|---|---|---|---|
${rows}
| **Total** | | **${q.credits}** | **${usd(q.usd)}** |

Ceiling: ${usd(q.ceilingUsd)} per run (MX_MAX_SPEND_PER_RUN) · ${q.overCeiling ? "**OVER the ceiling: cannot be approved.**" : "within the ceiling."}
${dry ? `\nVoice dry run (free listen-through, macOS say): \`dryrun/vo.aiff\`, ${dry.seconds.toFixed(1)} s at ${dry.wordsPerSecond} words/s for a ${dry.targetSeconds.toFixed(1)} s ad. say's pace is not the narrator's; timing is checked on the recorded narration.\n` : plan.voice.mode === "none" ? "\nNo narration: captions-only format.\n" : ""}
To approve exactly this quote:

\`\`\`
mixtape render ${scriptRef} --approve ${q.id}
\`\`\`

## Narration

${plan.voice.text || "(none)"}
${plan.stage === "clips" ? `\n## Clips (${plan.clips.length})\n\n${clips}\n` : ""}
## Stills (${plan.stills.length})

${stills}
`;
}

const shotId = (n: number) => `shot_${String(n).padStart(2, "0")}`;

/** Cut timing from the recorded narration when it exists (voice/words.json covering every shot), else the structure's windows. */
function plannedTimes(dir: string, plan: Plan): { times: ShotTime[]; fromRead: boolean } {
  const file = join(dir, "voice", "words.json");
  const endCard = Boolean(plan.shots.at(-1)?.end_card);
  if (plan.voice.mode === "narrator" && existsSync(file)) {
    try {
      const words = JSON.parse(readFileSync(file, "utf8")) as Word[];
      if (plan.shots.every((s) => words.some((w) => w.shot === s.n))) return { times: shotTimes({ shots: plan.shots, endCard }, words), fromRead: true };
    } catch {
      // unreadable: fall through to the structure windows
    }
  }
  return { times: shotTimes({ shots: plan.shots, endCard }, null), fromRead: false };
}

/**
 * Once the narration is on file, the read is the ad's length (sprint 13): the plan's duration and
 * every shot's window follow the recorded words, and the structure's target is kept only for the
 * comparison. Nothing in the quote id depends on these, so approvals are unaffected.
 */
function cutToRead(dir: string, plan: Plan): void {
  if (plan.stage === "voice") return;
  const { times, fromRead } = plannedTimes(dir, plan);
  if (!fromRead) return;
  const end = times.at(-1)?.end ?? 0;
  if (end <= 0) return;
  plan.read_s = end; // already rounded to 3 decimals by shotTimes, like every window
  plan.duration_s = plan.read_s;
  for (const [i, s] of plan.shots.entries()) {
    const t = times[i];
    if (t) s.t_target = [t.start, t.end];
  }
}

const REFS_FILE = "spans.json";

/**
 * Tight audio refs for the speaking shots (sync.ts tightRef) from the lines recorded in the stills
 * run (`voice/lines/line_NN.wav`, one per shot in order). Rebuilt only when missing; spans are kept
 * beside them for the sync gate. Shots whose line isn't recorded yet get no ref (no lips this run).
 */
async function audioRefs(dir: string, plan: Plan, times: ShotTime[]): Promise<Map<number, { file: string; span: Span }>> {
  const refs = new Map<number, { file: string; span: Span }>();
  if (plan.voice.mode !== "narrator") return refs;
  const refDir = join(dir, "voice", "refs");
  const spansFile = join(refDir, REFS_FILE);
  const spans: Record<string, Span & { padTo?: number }> = existsSync(spansFile) ? (JSON.parse(readFileSync(spansFile, "utf8")) as Record<string, Span & { padTo?: number }>) : {};
  for (const [i, s] of plan.shots.entries()) {
    if (!s.speaker) continue;
    const line = join(dir, "voice", "lines", `line_${String(i + 1).padStart(2, "0")}.wav`);
    if (!existsSync(line)) continue;
    const id = `clip_${String(s.n).padStart(2, "0")}`;
    const file = join(refDir, `${id}.wav`);
    // The ref runs the clip's full length (silence after the words), so the model has no room to re-time.
    const t = times[i];
    const padTo = clipSeconds(t ? t.end - t.start : s.t_target[1] - s.t_target[0]);
    let span = spans[id];
    if (!existsSync(file) || !span || span.padTo !== padTo || statSync(file).mtimeMs < statSync(line).mtimeMs) {
      try {
        const r = await tightRef(line, file, padTo);
        span = { ...r.span, padTo };
        spans[id] = span;
      } catch {
        continue;
      }
    }
    refs.set(s.n, { file, span: { start: span.start, end: span.end } });
  }
  if (refs.size) {
    mkdirSync(refDir, { recursive: true });
    writeFileSync(spansFile, JSON.stringify(spans, null, 2) + "\n");
  }
  return refs;
}

/** Every shot still QC-passed and on disk → the motion stage can start. Returns the still files by id, or null. */
export function lockedStills(dir: string, plan: Plan): Record<string, string> | null {
  const verdicts = qcVerdicts(dir, "stills");
  const files: Record<string, string> = {};
  for (const s of plan.shots) {
    const id = shotId(s.n);
    const f = join(dir, "stills", `${id}.png`);
    if (verdicts.get(id) !== "pass" || !existsSync(f)) return null;
    files[id] = f;
  }
  for (const j of plan.stills) if (j.kind !== "shot" && existsSync(join(dir, "stills", `${j.id}.png`))) files[j.id] = join(dir, "stills", `${j.id}.png`);
  return files;
}

export async function renderPlan(file: string, opts: RenderOptions, root: string = process.cwd(), config: Config = loadConfig(root)): Promise<RenderPlanResult> {
  const script = loadScript(file);

  // The originality guard runs again here, before anything is planned or paid (PRD F5).
  const sourceText = cachedSourceText(root, script.structure.source.kind === "template" ? undefined : script.structure.source.cache_id);
  const audit = auditScript(script, sourceText);
  if (audit.errors.length) throw new MixtapeError(`render refused: the script fails its checks.\n  ${audit.errors.join("\n  ")}`);

  const slug = slugFor(file, opts);
  const mode = modeFor(opts, config);
  const plan = buildPlan(script, slug, mode);
  const dir = join(root, "renders", slug);
  const pending = unfetchedPaid(dir, config);
  if (pending.length) out(`  note: ${pending.length} paid job(s) not downloaded yet (${pending.join(", ")}). Run --fetch and QC them first, or a changed plan will regenerate them.`);

  const account = loadAccount(root);
  // The delivery tag: the script's register tag (press --register) wins over the account's.
  const tag = script.audio.delivery_tag ?? account.narrator?.delivery_tag;
  if (plan.voice.mode === "narrator" && config.MX_VOICE_SOURCE === "elevenlabs" && tag) {
    plan.voice.tag = tag;
    plan.voice.chars = takeBody(plan.voice.text, tag).length;
  }
  const voiceCached = cachedVoiceChars(dir, plan, config, account);

  // The voice comes first (sprint 12): the narration is the cheapest paid step (~$0.05) and its real
  // read length is the timing verdict, so it is recorded before any still is bought. The same rule
  // covers a --still render remade in motion: the lips refs and the cut must use the same take.
  if (plan.voice.mode === "narrator" && config.MX_VOICE_SOURCE === "elevenlabs" && voiceCached < plan.voice.chars) {
    plan.stage = "voice";
  } else if (mode === "motion" && lockedStills(dir, plan)) {
    plan.stage = "clips";
  }
  cutToRead(dir, plan);
  if (plan.stage === "clips") {
    const d = config.MX_VIDEO_SOURCE === "dreamina" && existsSync(join(dir, "dreamina.json")) ? dreaminaFor(dir, config) : null;
    const clipVerdicts = qcVerdicts(dir, "clips");
    // One retake per clip: a clip that failed QC (or the sync gate) after its retake keeps the still (0 cr).
    const failedAgain = (id: string) => clipVerdicts.get(id) === "fail" || Boolean(d?.state.nodes[id]?.failed?.startsWith("sync"));
    const stillOnly = new Set(plan.shots.map((s) => `clip_${String(s.n).padStart(2, "0")}`).filter((id) => failedAgain(id) && (d?.qcRetakes(id) ?? 0) >= 1));
    // Speaking shots lip-sync to their own recorded line (rule 0): a tight ref per shot, free, from the stills run's takes.
    const { times } = plannedTimes(dir, plan);
    const refs = config.MX_VIDEO_SOURCE === "dreamina" ? await audioRefs(dir, plan, times) : new Map<number, { file: string; span: Span }>();
    plan.clips = buildClipPlan(plan, times, { model: config.MX_VIDEO_MODEL, silentModel: config.MX_VIDEO_MODEL_SILENT, stillOnly, audioFor: (n) => refs.get(n)?.file });
  }

  const onFile = new Set([...reusableStills(dir, plan, config), ...reusableClips(dir, plan, config)]);
  const quote = buildQuote(plan, ratesFrom(config), { onFile, voiceCachedChars: voiceCached });

  // Check an approval before writing anything, so a wrong id leaves no trace.
  const token = opts.approve !== undefined ? approveQuote(quote, opts.approve) : null;

  mkdirSync(dir, { recursive: true });
  // An approval belongs to one exact plan. If the plan changed, retire it so it can never be used.
  const approvalFile = join(dir, "approval.json");
  if (existsSync(approvalFile)) {
    let approvedId = "";
    try {
      approvedId = String((JSON.parse(readFileSync(approvalFile, "utf8")) as { quoteId?: unknown }).quoteId ?? "");
    } catch {
      // unreadable approval: treat as stale
    }
    if (approvedId !== quote.id) {
      renameSync(approvalFile, join(dir, "approval.stale.json"));
      out(`  note: the plan changed since ${approvedId || "the last approval"}; that approval is retired (approval.stale.json).`);
    }
  }
  // The free `say` listen-through only matters when no real narration will be recorded (MX_VOICE_SOURCE=say).
  const dryRun = opts.dryRun === false || config.MX_VOICE_SOURCE === "elevenlabs" ? null : await voiceDryRun(plan, dir).catch(() => null);
  const scriptRef = relative(root, resolve(file)) || file;
  writeFileSync(join(dir, "plan.json"), JSON.stringify(plan, null, 2) + "\n");
  writeFileSync(join(dir, "quote.json"), JSON.stringify({ ...quote, script: scriptRef, dryRun }, null, 2) + "\n");
  writeFileSync(join(dir, "QUOTE.md"), quoteMarkdown(plan, quote, dryRun, scriptRef));
  if (token) writeFileSync(join(dir, "approval.json"), JSON.stringify({ ...token, approvedAt: new Date().toISOString(), script: scriptRef }, null, 2) + "\n");
  return { slug, dir, plan, quote, dryRun, approved: token !== null };
}

function dreaminaFor(dir: string, config: Config): Dreamina {
  return new Dreamina({ dir, pollSeconds: config.MX_POLL_SECONDS, timeoutSeconds: config.MX_WAIT_TIMEOUT_SECONDS, videoResolution: config.MX_VIDEO_RESOLUTION, ...(config.MX_DREAMINA_BIN ? { bin: config.MX_DREAMINA_BIN } : {}) });
}

/** One spend ledger per approved quote (a retake's approval gets its own). Migrates the old spend.json. */
export function ledgerFile(dir: string, quoteId: string): string {
  const file = join(dir, `spend-${quoteId}.json`);
  const legacy = join(dir, "spend.json");
  if (!existsSync(file) && existsSync(legacy)) {
    const l = JSON.parse(readFileSync(legacy, "utf8")) as { quoteId?: string };
    if (l.quoteId === quoteId) renameSync(legacy, file);
  }
  return file;
}

/** Everything spent on this render across all its approvals. */
export function totalSpent(dir: string): { credits: number; usd: number } {
  if (!existsSync(dir)) return { credits: 0, usd: 0 };
  return readdirSync(dir)
    .filter((f) => /^spend(-q-[0-9a-f]{10})?\.json$/.test(f))
    .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as { spentCredits: number; spentUsd: number })
    .reduce((a, l) => ({ credits: a.credits + l.spentCredits, usd: Math.round((a.usd + l.spentUsd) * 1e6) / 1e6 }), { credits: 0, usd: 0 });
}

/** Paid Dreamina nodes that finished or are running but haven't been downloaded. */
function unfetchedPaid(dir: string, config: Config): string[] {
  if (config.MX_IMAGE_SOURCE !== "dreamina" || !existsSync(join(dir, "dreamina.json"))) return [];
  const d = dreaminaFor(dir, config);
  return Object.entries(d.state.nodes)
    .filter(([, n]) => n.accepted && !n.failed && !(n.file && existsSync(n.file)))
    .map(([id]) => id);
}

/**
 * Stills that can be reused without paying again: QC-passed shots (locked even if the planner's
 * wording changed), and any still whose exact prompt is unchanged. QC-failed shots never are.
 */
export function reusableStills(dir: string, plan: Plan, config: Config): Set<string> {
  const keep = new Set<string>();
  if (config.MX_IMAGE_SOURCE !== "dreamina" || !existsSync(join(dir, "dreamina.json"))) return keep;
  const d = dreaminaFor(dir, config);
  const prev = join(dir, "plan.json");
  const old = existsSync(prev) ? (JSON.parse(readFileSync(prev, "utf8")) as Plan) : null;
  // Nodes made before hashes were stored: hash the plan that made them.
  if (old) d.backfill(old.stills.map((j) => ({ id: j.id, hash: j.hash ?? stillHash(j) })));
  const verdicts = qcVerdicts(dir, "stills");
  // A sheet or plate that a QC-passed shot was built on is locked with it.
  const lockedUpstream = new Set(
    [...(old?.stills ?? []), ...plan.stills].filter((j) => j.kind === "shot" && verdicts.get(j.id) === "pass").flatMap((j) => j.refs),
  );
  for (const j of plan.stills) {
    const v = j.kind === "shot" ? verdicts.get(j.id) : undefined;
    if (v === "fail") continue;
    if (d.reusable(j, j.kind === "shot" ? v === "pass" : lockedUpstream.has(j.id)) || d.paid(j)) keep.add(j.id);
  }
  return keep;
}

/** Clips on file: QC-passed (locked) or unchanged and not yet judged. A QC-failed clip is a retake. */
export function reusableClips(dir: string, plan: Plan, config: Config): Set<string> {
  const keep = new Set<string>();
  if (plan.stage !== "clips" || config.MX_VIDEO_SOURCE !== "dreamina" || !existsSync(join(dir, "dreamina.json"))) return keep;
  const d = dreaminaFor(dir, config);
  const prev = join(dir, "plan.json");
  const old = existsSync(prev) ? (JSON.parse(readFileSync(prev, "utf8")) as Partial<Plan>) : null;
  if (old?.clips?.length) d.backfillClips(old.clips.map((c) => ({ id: c.id, hash: c.hash, base: c.base ?? "", seconds: c.seconds })));
  const verdicts = qcVerdicts(dir, "clips");
  for (const c of plan.clips) {
    const v = verdicts.get(c.id);
    if (v === "fail") continue;
    if (d.reusableClip(c, v === "pass") || d.paid(c)) keep.add(c.id);
  }
  return keep;
}

/**
 * Narration characters already in the voice cache, so a re-quote doesn't bill them: the one-take
 * recording (any seed), else the lines recorded one by one before sprint 12.
 */
function cachedVoiceChars(dir: string, plan: Plan, config: Config, account: Account): number {
  if (plan.voice.mode !== "narrator" || config.MX_VOICE_SOURCE !== "elevenlabs") return 0;
  const n = account.narrator;
  if (!n) return 0;
  const model = narratorModel(account, plan.mode);
  const cache = join(dir, "voice", "cache");
  const body = takeBody(takeText(plan.shots.map((s) => ({ text: s.vo }))), plan.voice.tag);
  if ([0, 1, 2].some((seed) => existsSync(join(cache, `${takeKey(n.voice_id, model, body, seed)}.mp3`)))) return plan.voice.chars;
  const cached = plan.shots.filter((s) => existsSync(join(cache, `${takeKey(n.voice_id, model, s.vo, 0)}.mp3`)));
  return cached.length === plan.shots.length ? plan.voice.chars : cached.reduce((a, s) => a + s.vo.length, 0);
}

/** Download paid stills/clips that finished (no spend). */
export async function renderFetch(file: string, opts: RenderOptions, root: string = process.cwd(), config: Config = loadConfig(root)): Promise<{ fetched: string[]; failed: string }> {
  const dir = join(root, "renders", slugFor(file, opts));
  const ids = unfetchedPaid(dir, config);
  if (!ids.length) return { fetched: [], failed: "" };
  const d = dreaminaFor(dir, config);
  try {
    await d.waitAndFetch(ids);
    return { fetched: ids, failed: "" };
  } catch (e) {
    return { fetched: ids.filter((id) => d.state.nodes[id]?.file), failed: e instanceof Error ? e.message : "unknown" };
  }
}

function slugFor(file: string, opts: RenderOptions): string {
  const slug = opts.slug ?? basename(file).replace(/(\.script)?\.json$/, "").toLowerCase().replace(/[^a-z0-9-]+/g, "-").slice(0, 64);
  if (!SLUG.test(slug)) throw new MixtapeError(`"${slug}" is not a usable slug (lowercase letters, digits, dashes; 3-64 chars). Pass --slug.`);
  return slug;
}

export interface RenderRunResult {
  slug: string;
  dir: string;
  out: string;
  seconds: number;
  /** What the cut is meant to run: the structure's target, or the recorded read once it is on file (`readSeconds`). */
  targetSeconds: number;
  readSeconds: number | null;
  spent: { credits: number; usd: number };
  qcPrompt: string;
  serverCredits: number | null;
  stage: Plan["stage"];
  /** Motion stage: shots that fell back to their still (clip failed or still-only). */
  stillShots: number[];
}

/** Record (or reuse) the narration for this plan's mode; every take reserves its cost in the budget first. */
async function narrate(plan: Plan, dir: string, config: Config, account: Account, budget: Budget): Promise<{ words: Word[] | null; narration: string | null }> {
  if (plan.voice.mode !== "narrator") return { words: null, narration: null };
  const voiceDir = join(dir, "voice");
  const lines = plan.shots.map((s) => ({ shot: s.n, text: s.vo }));
  if (config.MX_VOICE_SOURCE === "say") {
    const v = await recordSay(lines, voiceDir);
    return { words: v.words, narration: v.wav };
  }
  if (!config.ELEVENLABS_API_KEY) throw new MixtapeError("ELEVENLABS_API_KEY is missing from .env.local (or set MX_VOICE_SOURCE=say for a free placeholder).");
  if (!account.narrator) throw new MixtapeError("renders/account.json has no narrator (voice_id, model).");
  const v = await recordEleven(lines, voiceDir, {
    key: config.ELEVENLABS_API_KEY,
    voiceId: account.narrator.voice_id,
    model: narratorModel(account, plan.mode),
    usdPer1kChars: config.MX_VOICE_USD_PER_1K_CHARS,
    budget,
    voiceSettings: account.narrator.voice_settings,
    deliveryTag: plan.voice.tag,
  });
  return { words: v.words, narration: v.wav };
}

/** Stills through Dreamina (or the free placeholder), reusing what is on file; returns still files by id. */
async function makeStills(r: RenderPlanResult, config: Config, token: ReturnType<typeof approveQuote>, budget: Budget): Promise<{ stills: Record<string, string>; serverCredits: number | null }> {
  const plan = r.plan;
  if (config.MX_IMAGE_SOURCE === "placeholder") return { stills: await placeholderStills(plan.stills, r.dir), serverCredits: null };
  const d = dreaminaFor(r.dir, config);
  await d.ensureProject(`mixtape ${r.slug}`);
  // Reuse what is on file (QC-passed, or same prompt); only the rest is saved, quoted and run.
  const reuse = reusableStills(r.dir, plan, config);
  const todo = plan.stills.filter((j) => !reuse.has(j.id));
  // A still that already exists but can't be reused (QC failed) is a retake: fresh node, never the old picture.
  const verdicts = qcVerdicts(r.dir, "stills");
  for (const j of todo) if (d.state.nodes[j.id]?.file) d.retire(j.id, verdicts.get(j.id) === "fail" ? "QC fail" : "replaced");
  for (const j of todo) await d.saveNode(j, r.slug);
  // Server quote before any spend. Shots whose upstream refs haven't run quote 0 until they can;
  // they are re-quoted (and reserved) just before they run, still inside the same approval.
  let total = 0;
  for (const j of todo) total += await d.quote(j.id).catch(() => 0);
  if (total > token.maxCredits) throw new MixtapeError(`STOP: Dreamina quotes ${total} cr, above the approved ${token.maxCredits} cr. Nothing was run. Re-quote with MX_CREDITS_PER_STILL set to the real price.`);
  out(`  Dreamina server quote ${total} cr for ${todo.length} still(s), ${reuse.size} on file (approved ${token.maxCredits} cr)`);
  // Paid-but-pending stills from an earlier run are waited for and fetched, never re-run.
  const pending = plan.stills.filter((j) => reuse.has(j.id) && d.paid(j));
  const upstream = [...todo, ...pending].filter((j) => j.kind !== "shot").map((j) => j.id);
  const shots = [...todo, ...pending].filter((j) => j.kind === "shot").map((j) => j.id);
  let stills: Record<string, string> = Object.fromEntries([...reuse].filter((id) => d.state.nodes[id]?.file).map((id) => [id, d.state.nodes[id]?.file ?? ""]));
  for (const j of todo) if (j.kind !== "shot") await d.run(j.id, budget);
  stills = { ...stills, ...(await d.waitAndFetch(upstream)) };
  for (const j of todo) if (j.kind === "shot") await d.run(j.id, budget);
  stills = { ...stills, ...(await d.waitAndFetch(shots)) };
  return { stills, serverCredits: total };
}

/**
 * Clips through Dreamina (Seedance, m2v from each locked still) or the free placeholder. A clip
 * that Dreamina fails is left out: its shot falls back to the still, never blocking delivery.
 */
async function makeClips(r: RenderPlanResult, stills: Record<string, string>, times: ShotTime[], words: Word[] | null, config: Config, token: ReturnType<typeof approveQuote>, budget: Budget): Promise<{ clips: Record<string, ClipSegment>; serverCredits: number | null; sync: Record<string, SyncVerdict & Partial<Fit>> }> {
  const plan = r.plan;
  const asSegments = (files: Record<string, string>): Record<string, ClipSegment> => Object.fromEntries(Object.entries(files).map(([id, file]) => [id, { file }]));
  if (config.MX_VIDEO_SOURCE === "placeholder") return { clips: asSegments(await placeholderClips(plan.clips, stills, r.dir)), serverCredits: null, sync: {} };
  const d = dreaminaFor(r.dir, config);
  await d.ensureProject(`mixtape ${r.slug}`);
  const reuse = reusableClips(r.dir, plan, config);
  const todo = plan.clips.filter((c) => !reuse.has(c.id));
  const verdicts = qcVerdicts(r.dir, "clips");
  for (const c of todo) {
    const n = d.state.nodes[c.id];
    if (!n?.file) continue;
    const failed = verdicts.get(c.id) === "fail";
    // A sync-gate fail counts as the clip's one retake, like a QC fail.
    d.retire(c.id, failed ? "QC fail" : n.failed ? `failed (${n.failed})` : "replaced");
    // (a clip reused by base+length never reaches here: it is in `reuse`)
    // The verdict belonged to the retired clip; the retake is judged afresh.
    if (failed) consumeVerdict(r.dir, "clips", c.id);
  }
  for (const c of todo) {
    const still = stills[c.still];
    if (!still) throw new MixtapeError(`Missing locked still ${c.still} for ${c.id}.`);
    await d.saveClipNode(c, r.slug, still);
  }
  let total = 0;
  for (const c of todo) total += await d.quote(c.id).catch(() => 0);
  if (total > token.maxCredits) throw new MixtapeError(`STOP: Dreamina quotes ${total} cr for the clips, above the approved ${token.maxCredits} cr. Nothing was run. Re-quote with MX_CREDITS_PER_VIDEO_SEC set to the real price.`);
  out(`  Dreamina server quote ${total} cr for ${todo.length} clip(s), ${reuse.size} on file (approved ${token.maxCredits} cr)`);
  const pending = plan.clips.filter((c) => reuse.has(c.id) && d.paid(c));
  let files: Record<string, string> = Object.fromEntries([...reuse].filter((id) => d.state.nodes[id]?.file).map((id) => [id, d.state.nodes[id]?.file ?? ""]));
  for (const c of todo) await d.run(c.id, budget);
  files = { ...files, ...(await d.waitAndFetch([...todo, ...pending].map((c) => c.id), true)) };

  // Sync gate + line-lock (rule 0 steps 4-5) for every speaking clip that has a file.
  const spansFile = join(r.dir, "voice", "refs", REFS_FILE);
  const spans: Record<string, Span> = existsSync(spansFile) ? (JSON.parse(readFileSync(spansFile, "utf8")) as Record<string, Span>) : {};
  const syncFile = join(r.dir, "clips-sync.json");
  const sync: Record<string, SyncVerdict & Partial<Fit>> = existsSync(syncFile) ? (JSON.parse(readFileSync(syncFile, "utf8")) as Record<string, SyncVerdict & Partial<Fit>>) : {};
  const clips: Record<string, ClipSegment> = {};
  for (const c of plan.clips) {
    const file = files[c.id];
    if (!file) continue;
    const take = spans[c.id];
    if (!c.audio || !take) {
      // A reused clip a touch shorter than its window (CLIP_SHORT_TOLERANCE) is slowed, never below 0.9x; the cut holds the rest.
      const i = plan.shots.findIndex((s) => s.n === c.shot);
      const t = times[i];
      const window = t ? t.end - t.start : c.seconds;
      const have = await audioSeconds(file).catch(() => 0);
      const speed = have > 0 && have < window - 0.05 ? Math.max(SPEED_MIN, have / window) : 1;
      clips[c.id] = { file, ...(speed < 1 ? { speed: Math.round(speed * 1000) / 1000 } : {}) };
      continue;
    }
    // A locked (QC-passed, on file) clip keeps its recorded verdict and fit; a fresh one is judged now.
    let v = reuse.has(c.id) && sync[c.id] ? sync[c.id] : undefined;
    if (!v) {
      const judged = judgeSync(await speechSpan(file).catch(() => null), take);
      const i = plan.shots.findIndex((s) => s.n === c.shot);
      const shotStart = times[i]?.start ?? 0;
      const firstWord = words?.find((w) => w.shot === c.shot)?.s ?? shotStart;
      v = { ...judged, ...(judged.pass ? lineLock(judged, Math.max(0, firstWord - shotStart)) : {}) };
      sync[c.id] = v;
    }
    if (!v.pass) {
      d.fail(c.id, `sync: ${v.why}`);
      out(`  warn: ${c.id} failed the sync gate (${v.why}); its shot keeps the still this run. The next quote retakes it once.`);
      continue;
    }
    clips[c.id] = { file, ...(v.trimStart ? { trimStart: v.trimStart } : {}), ...(v.speed && v.speed !== 1 ? { speed: v.speed } : {}) };
  }
  writeFileSync(syncFile, JSON.stringify(sync, null, 2) + "\n");
  return { clips, serverCredits: total, sync };
}

/**
 * The paid run: only with approval.json matching the CURRENT quote. Dreamina's server quote must
 * be within the approved credits before anything runs; every paid call reserves its cost in the
 * ledger first. Stills stage: stills, narration, stills cut, QC prompt. Clips stage (motion mode,
 * every still locked): narration if not on file, clips, motion cut, clip QC prompt. Safe to rerun.
 */
export async function renderRun(file: string, opts: RenderOptions, root: string = process.cwd(), config: Config = loadConfig(root)): Promise<RenderRunResult> {
  const r = await renderPlan(file, { ...(opts.slug ? { slug: opts.slug } : {}), ...(opts.still ? { still: true } : {}), dryRun: false }, root, config);
  const approvalFile = join(r.dir, "approval.json");
  // A quote with nothing to bill (everything on file or already paid for) needs no approval: this is a resume.
  const free = r.quote.credits === 0 && r.quote.usd === 0;
  if (!existsSync(approvalFile) && !free) {
    // An envelope the user granted this render approves the quote here, if it fits in what is left (sprint 13).
    const draw = drawEnvelope(r.dir, r.quote);
    if (!draw.ok) {
      const hint = readEnvelope(r.dir) ? ` Envelope: ${draw.why}; approve it by hand or grant a new envelope.` : "";
      throw new MixtapeError(`No approval for quote ${r.quote.id}. Read ${relative(root, join(r.dir, "QUOTE.md"))}, then run with --approve ${r.quote.id}.${hint}`);
    }
    const token = approveQuote(r.quote, r.quote.id);
    writeFileSync(approvalFile, JSON.stringify({ ...token, approvedAt: new Date().toISOString(), script: relative(root, resolve(file)) || file, envelope: true }, null, 2) + "\n");
    out(`  approved ${r.quote.id} under this render's envelope (${r.quote.credits} cr, $${r.quote.voiceUsd.toFixed(2)} narration); envelope left: ${draw.left.credits} cr, $${draw.left.usd.toFixed(2)}`);
  }
  const approvedId = existsSync(approvalFile) ? String((JSON.parse(readFileSync(approvalFile, "utf8")) as { quoteId?: unknown }).quoteId ?? "") : r.quote.id;
  if (free && approvedId !== r.quote.id) out(`  resuming: nothing new to bill (${r.quote.id}); paid jobs are fetched, not re-run.`);
  const token = approveQuote(r.quote, free ? r.quote.id : approvedId);
  const budget = Budget.open(ledgerFile(r.dir, token.quoteId), token, config.MX_CREDITS_PER_USD);
  const account = loadAccount(root);
  const plan = r.plan;

  // 0. voice stage: record the narration and report the read against the target; no picture is bought yet.
  if (plan.stage === "voice") {
    const { words, narration } = await narrate(plan, r.dir, config, account, budget);
    const times = shotTimes({ shots: plan.shots, endCard: Boolean(plan.shots.at(-1)?.end_card) }, words);
    const seconds = times.at(-1)?.end ?? 0;
    const result: RenderRunResult = { slug: r.slug, dir: r.dir, out: narration ?? "", seconds, targetSeconds: plan.target_s, readSeconds: seconds, spent: budget.spent, qcPrompt: "", serverCredits: null, stage: "voice", stillShots: [] };
    writeFileSync(join(r.dir, "render.json"), JSON.stringify({ ...result, times, at: new Date().toISOString(), mode: plan.mode, voice: config.MX_VOICE_SOURCE, voiceModel: narratorModel(account, plan.mode) }, null, 2) + "\n");
    return result;
  }

  // 1. picture sources
  let stills: Record<string, string>;
  let clips: Record<string, ClipSegment> = {};
  let serverCredits: number | null = null;
  if (plan.stage === "clips") {
    stills = lockedStills(r.dir, plan) ?? {};
  } else {
    ({ stills, serverCredits } = await makeStills(r, config, token, budget));
  }

  // 2. narration (clips stage: on file from the stills run unless the voice model changed)
  const { words, narration } = await narrate(plan, r.dir, config, account, budget);
  const last = plan.shots.at(-1);
  const times = shotTimes({ shots: plan.shots, endCard: Boolean(last?.end_card) }, words);

  // 3. clips (motion stage), sync-gated and line-locked to the narration
  if (plan.stage === "clips") ({ clips, serverCredits } = await makeClips(r, stills, times, words, config, token, budget));

  // 4. assembly
  const captions = words ? captionChunks(words, account.captions.words_per_chunk) : lineCaptions(plan.shots.map((s, i) => ({ n: s.n, vo: s.vo, t: times[i] ?? { start: 0, end: 0 } })));
  const lastTime = times.at(-1);
  const endCard = last?.end_card && lastTime ? { text: last.vo, start: lastTime.start, end: lastTime.end } : null;
  const outFile = join(r.dir, "out", `${r.slug}.mp4`);
  mkdirSync(join(r.dir, "out"), { recursive: true });
  const shotStills = plan.shots.map((s) => {
    const f = stills[shotId(s.n)];
    if (!f) throw new MixtapeError(`Missing still for ${shotId(s.n)}.`);
    return f;
  });
  const shotClips = plan.shots.map((s) => clips[`clip_${String(s.n).padStart(2, "0")}`] ?? null);
  const stillShots = plan.stage === "clips" ? plan.shots.filter((s, i) => !shotClips[i]).map((s) => s.n) : [];
  const cut = await buildCut({ dir: r.dir, stills: shotStills, ...(plan.stage === "clips" ? { clips: shotClips } : {}), times, captions, endCard, narration, look: { font: account.captions.font }, out: outFile });

  // 5. QC prompt + run summary
  const qcPrompt = await prepareQc(r.dir, plan, outFile, times, stills, Object.fromEntries(Object.entries(clips).map(([id, c]) => [id, c.file])));
  const result: RenderRunResult = { slug: r.slug, dir: r.dir, out: outFile, seconds: cut.seconds, targetSeconds: plan.duration_s, readSeconds: plan.read_s ?? null, spent: budget.spent, qcPrompt, serverCredits, stage: plan.stage, stillShots };
  writeFileSync(join(r.dir, "render.json"), JSON.stringify({ ...result, times, at: new Date().toISOString(), mode: plan.mode, images: config.MX_IMAGE_SOURCE, video: config.MX_VIDEO_SOURCE, voice: config.MX_VOICE_SOURCE, voiceModel: narratorModel(account, plan.mode) }, null, 2) + "\n");
  return result;
}

export function renderQcFinish(file: string, opts: RenderOptions, root: string = process.cwd()): { passed: boolean; failures: string[]; out: string; stage: Plan["stage"]; mode: Plan["mode"] } {
  const slug = slugFor(file, opts);
  const dir = join(root, "renders", slug);
  if (!existsSync(join(dir, "plan.json"))) throw new MixtapeError(`No render for ${slug}. Run mixtape render ${file} --run first.`);
  const plan = JSON.parse(readFileSync(join(dir, "plan.json"), "utf8")) as Plan;
  const r = finishQc(dir, plan);
  return { ...r, out: join(dir, "out", `${slug}.mp4`), mode: plan.mode ?? "still" };
}

export async function renderCommand(file: string | undefined, opts: RenderOptions): Promise<number> {
  if (!file) throw new MixtapeError("Give a script: mixtape render <script.json>.");
  const root = process.cwd();
  const again = `mixtape render ${relative(root, resolve(file))}${opts.slug ? ` --slug ${opts.slug}` : ""}${opts.still ? " --still" : ""}`;
  if (opts.qcFinish) {
    const q = renderQcFinish(file, opts, root);
    const what = q.stage === "clips" ? "clip" : "shot";
    if (!q.passed) {
      out(`QC failed (${q.failures.length}); verdicts in ${q.stage === "clips" ? "qc-clips.json" : "qc.json"}. Not delivered:`);
      for (const f of q.failures) out(`  - ${f}`);
      out(q.stage === "clips" ? `A clip retake needs its own quote:  ${again}  (a clip that fails twice keeps its still).` : `A ${what} retake needs its own quote: fix the shot in the script, re-press or edit, then render again.`);
      return 1;
    }
    if (q.stage === "stills" && q.mode === "motion") {
      out(`Stills QC passed and locked (qc.json). Stills cut: ${relative(root, q.out)}`);
      out(`Next, the motion stage: run  ${again}  for the clip quote (nothing billed until you approve it).`);
      return 0;
    }
    out(`QC passed; verdicts in ${q.stage === "clips" ? "qc-clips.json" : "qc.json"}. Delivered: ${relative(root, q.out)}`);
    return 0;
  }
  if (opts.fetch) {
    const f = await renderFetch(file, opts, root);
    out(f.fetched.length ? `downloaded ${f.fetched.length} paid job(s): ${f.fetched.join(", ")}` : "nothing to download");
    if (f.failed) out(f.failed);
    return f.failed ? 1 : 0;
  }
  if (opts.run) {
    const r = await renderRun(file, opts, root);
    if (r.stage === "voice") {
      const over = r.targetSeconds > 0 ? Math.round(((r.seconds - r.targetSeconds) / r.targetSeconds) * 100) : 0;
      out(`\nnarration recorded: ${relative(root, r.out)}  (the read runs ${r.seconds.toFixed(1)} s; script target ${r.targetSeconds.toFixed(1)} s, ${over >= 0 ? "+" : ""}${over}%)`);
      out(`spent $${r.spent.usd.toFixed(2)} on this approval`);
      if (Math.abs(over) > 10) out(`  note: the read is ${Math.abs(over)}% ${over > 0 ? "over" : "under"} the target. Clips are bought by the second: tighten (or stretch) the script now, before the stills, if that matters.`);
      out(`Next, the stills quote (cut to the read, nothing billed until you approve it):  ${again}`);
      return 0;
    }
    out(`\ncut built (${r.stage}): ${relative(root, r.out)}  (${r.seconds.toFixed(1)} s; ${r.readSeconds !== null ? `cut to the ${r.readSeconds.toFixed(1)} s read` : `script target ${r.targetSeconds.toFixed(1)} s`})`);
    if (r.stillShots.length) out(`  shots kept as stills: ${r.stillShots.join(", ")}`);
    const all = totalSpent(r.dir);
    out(`spent ${r.spent.credits} cr / $${r.spent.usd.toFixed(2)} on this approval; ${all.credits} cr / $${all.usd.toFixed(2)} on this render in total (spend-*.json)`);
    out(`QC next: answer ${relative(root, r.qcPrompt)}, then  ${again} --qc-finish`);
    return 0;
  }
  // --approve-envelope: grant (or replace) the envelope for this render, then show the plan as usual.
  const grant = opts.approveEnvelope !== undefined ? parseEnvelope(opts.approveEnvelope) : null;
  const r = await renderPlan(file, opts, root);
  const q = r.quote;
  const rel = relative(root, r.dir);
  if (grant) {
    grantEnvelope(r.dir, grant);
    out(`envelope granted for ${r.slug}: ${grant.credits} cr + $${grant.usd.toFixed(2)} narration (${rel}/envelope.json). Each --run approves its quote by itself while it fits; every quote is still shown here first.`);
  }
  const stage = r.plan.stage === "clips" ? `motion stage: ${r.plan.clips.length} clips` : r.plan.stage === "voice" ? "voice stage (the narration is recorded first; the stills quote is cut to the read)" : r.plan.mode === "motion" ? "stills stage (clips quoted after stills QC)" : "stills only";
  out(`render plan ${r.slug} [${stage}]: ${r.plan.shots.length} shots, ${r.plan.stills.length} stills, narration ${r.plan.voice.mode === "none" ? "none (captions-only)" : `${r.plan.voice.chars} chars`}`);
  for (const i of q.items) {
    const unit = i.units === 1 || i.unitName.endsWith("s") ? i.unitName : `${i.unitName}s`;
    out(`  ${i.label.padEnd(18)} ${String(i.units).padStart(5)} ${unit.padEnd(12)} ${i.credits ? `${i.credits} cr`.padStart(7) : "       "}  $${i.usd.toFixed(2)}`);
  }
  out(`  ${"total (estimate)".padEnd(18)} ${"".padStart(18)} ${`${q.credits} cr`.padStart(7)}  $${q.usd.toFixed(2)}   ceiling $${q.ceilingUsd.toFixed(2)}${q.overCeiling ? "  OVER" : ""}`);
  if (r.dryRun) out(`  voice dry run (listen-through, free): ${relative(root, r.dryRun.file)}  ${r.dryRun.seconds.toFixed(1)} s at ${r.dryRun.wordsPerSecond} words/s`);
  out(`  prompts and quote: ${rel}/QUOTE.md`);
  if (r.plan.read_s !== undefined) out(`  length: the ${r.plan.read_s.toFixed(1)} s read (script target ${r.plan.target_s} s); shots are cut to it`);
  if (r.approved) {
    out(`\nApproved ${q.id} (max ${q.credits} cr / $${q.usd.toFixed(2)}). Nothing billed yet. Run it:  ${again} --run`);
    return 0;
  }
  if (q.overCeiling) {
    out(`\nOver the ceiling: raise MX_MAX_SPEND_PER_RUN or cut shots. Nothing was billed.`);
    return 0;
  }
  const env = readEnvelope(r.dir);
  if (env) {
    const left = envelopeLeft(env);
    const fits = q.credits <= left.credits && q.voiceUsd <= left.usd + 1e-6;
    out(`\nEnvelope left: ${left.credits} cr, $${left.usd.toFixed(2)} narration. ${fits ? `This quote fits: ${again} --run approves and runs it.` : `This quote does not fit: approve it by hand (${again} --approve ${q.id}) or grant a new envelope.`} Nothing was billed.`);
    return 0;
  }
  out(`\nNothing was billed. To approve exactly this quote:  ${again} --approve ${q.id}`);
  return 0;
}
