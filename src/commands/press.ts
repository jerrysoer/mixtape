import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { z } from "zod";
import { buildPressPrompt } from "../claude/prompts/press.js";
import { checkOriginality } from "../guard/originality.js";
import { longestSharedRun, mentionsName, nearCopy, words } from "../guard/overlap.js";
import { auditScript, hookWordLimit, isCaptionsOnly } from "../guard/script.js";
import { HOOK_MAX_SHARED_RUN } from "../hooks/score.js";
import { MixtapeError, out } from "../lib/io.js";
import { loadConfig } from "../config.js";
import { loadAccount, narratorRate } from "../render/account.js";
import { MAX_RATE, imperfectLines } from "../render/imperfect.js";
import { findRegister } from "../render/register.js";
import { assertJobId, cachedSourceText, newJobId, projectPaths, type Paths } from "../lib/jobs.js";
import { scriptSchema, shotSchema, type Script } from "../schema/script.js";
import { BEAT_ROLES, formatIssues, structureSchema, type Structure } from "../schema/structure.js";
import { loadStructure } from "./hook.js";

const MAX_ANSWER_BYTES = 128 * 1024;
const BRIEF_MIN = 20;
const BRIEF_MAX = 2000;

export interface PressOptions {
  /** 1-based index into hook.candidates (default 1). */
  hook?: string;
  /** Use this hook line instead of a candidate. */
  hookLine?: string;
  briefFile?: string;
  style?: string;
  styleRef?: string;
  finish?: string;
  answer?: string;
  out?: string;
  /** Imperfection layer rate (0.1–0.2 natural; max 0.3) applied to the lines after the audit. */
  imperfect?: string;
  /** Seed for --imperfect (default 1); same seed = same take. */
  seed?: string;
  /** Narration register id from docs/NARRATION-BANK.md: the monologue is written in it first, its tag fronts the take. */
  register?: string;
  /** Batch mode: the batch prints its own next steps. */
  quiet?: boolean;
}

function parseImperfect(opts: PressOptions): { rate: number; seed: number } | null {
  if (opts.imperfect === undefined) return null;
  const rate = Number(opts.imperfect);
  if (!Number.isFinite(rate) || rate < 0 || rate > MAX_RATE) throw new MixtapeError(`--imperfect must be 0-${MAX_RATE} (10-20% sounds like a person; above that it is sloppy).`);
  const seed = opts.seed === undefined ? 1 : Number(opts.seed);
  if (!Number.isInteger(seed) || seed < 0) throw new MixtapeError("--seed must be a whole number.");
  return { rate, seed };
}

const candidateSchema = z.object({ text: z.string(), score: z.number().nullable() });

const registerSchema = z.object({ id: z.string(), who: z.string(), move: z.string(), rhythm: z.string(), tag: z.string(), example: z.string() });

const jobSchema = z.object({
  id: z.string(),
  created: z.string(),
  ref: z.string(),
  brief: z.string(),
  /** null = the structure had no hooks and none was given: the answer writes `hook.line` (sprint 13). */
  hookLine: z.string().nullable(),
  candidates: z.array(candidateSchema),
  style: z.string().nullable(),
  styleRef: z.string().nullable(),
  imperfect: z.object({ rate: z.number(), seed: z.number() }).nullable().optional(),
  /** Speaking rate the prompt and audit use (words/s); absent on jobs from before 2026-11-07 = 2.5. */
  wordsPerSecond: z.number().optional(),
  /** --register: the monologue is written in this register first; the answer must carry `monologue`. */
  register: registerSchema.nullable().optional(),
});
type PressJob = z.infer<typeof jobSchema>;

/** What Claude writes. Times, role order, music and voice come from the structure and job; the hook line too unless press wrote none. */
const answerSchema = z
  .object({
    /** With --register: the whole ad as one monologue; must equal the hook + beat lines joined. */
    monologue: z.string().optional(),
    hook: z.object({ line: z.string().optional(), visual: z.string(), shot: shotSchema }).strict(),
    beats: z.array(z.object({ role: z.enum(BEAT_ROLES), line: z.string(), visual: z.string(), shot: shotSchema }).strict()),
    cast: z.record(z.string(), z.string()),
    wardrobe: z.record(z.string(), z.record(z.string(), z.string())),
    sets: z.record(z.string(), z.string()),
    style_prompt: z.string().optional(),
  })
  .strict();

function rel(p: Paths, abs: string): string {
  return relative(p.root, abs) || ".";
}

function cacheIdOf(s: Structure): string | undefined {
  return s.source.kind === "template" ? undefined : s.source.cache_id;
}

/** Scores written by `mixtape hook --finish` beside the structure (<base>.hooks.json). */
function hookScores(input: string): Map<string, number> {
  const scores = new Map<string, number>();
  if (/^f\d{1,3}$/i.test(input.trim())) return scores;
  const file = resolve(input).replace(/(\.structure)?\.json$/, ".hooks.json");
  if (!existsSync(file)) return scores;
  try {
    const ranked = z.object({ ranked: z.array(z.object({ text: z.string(), score: z.number() }).passthrough()) }).parse(JSON.parse(readFileSync(file, "utf8"))).ranked;
    for (const h of ranked) scores.set(h.text, h.score);
  } catch {
    // unreadable scores are not fatal: candidates keep score null
  }
  return scores;
}

export async function pressPrep(input: string, briefArg: string | undefined, opts: PressOptions, p: Paths = projectPaths()): Promise<{ id: string }> {
  const brief = (opts.briefFile ? readFileSync(resolve(opts.briefFile), "utf8") : (briefArg ?? "")).trim();
  if (brief.length < BRIEF_MIN) throw new MixtapeError(`Give a brief of at least ${BRIEF_MIN} characters: what the product is, the facts you can claim, the offer.`);
  if (brief.length > BRIEF_MAX) throw new MixtapeError(`The brief is too long (${BRIEF_MAX} characters max).`);
  const { structure, label } = loadStructure(input);
  // The narrator's measured pace for the render mode this script will go to (account.json), else 2.5.
  const account = loadAccount(p.root);
  const wordsPerSecond = narratorRate(account, loadConfig(p.root).MX_RENDER_MODE);

  const scores = hookScores(input);
  const candidates = structure.hook.candidates.map((text) => ({ text, score: scores.get(text) ?? null }));
  // The hook: --hook-line, else candidate n from `mixtape hook`, else (no hooks written for this
  // structure) press writes it in the same answer: one thinking step for a single ad (sprint 13).
  let hookLine: string | null = opts.hookLine?.trim() || null;
  if (!hookLine && (candidates.length > 0 || opts.hook)) {
    if (candidates.length === 0) throw new MixtapeError(`${label} has no hook candidates to pick from with --hook. Run  mixtape hook ${input} --topic "<topic>"  first, pass --hook-line "<line>", or leave both out and press writes the hook.`);
    const n = opts.hook ? Number(opts.hook) : 1;
    if (!Number.isInteger(n) || n < 1 || n > candidates.length) throw new MixtapeError(`--hook must be 1-${candidates.length}.`);
    hookLine = candidates[n - 1]?.text ?? null;
  }
  const limit = hookWordLimit(structure, wordsPerSecond);
  const sourceText = cachedSourceText(p.root, cacheIdOf(structure));
  if (hookLine) {
    if (hookLine.length > 160) throw new MixtapeError("The hook line is too long (160 characters max).");
    const hookWords = words(hookLine).length;
    if (hookWords > limit) {
      const win = structure.hook.t[1] - structure.hook.t[0];
      const fits = candidates.map((c, i) => ({ c, i })).filter(({ c }) => words(c.text).length <= limit);
      const hint = fits.length ? ` Candidates that fit: ${fits.map(({ c, i }) => `--hook ${i + 1} ("${c.text}")`).join(", ")}.` : "";
      throw new MixtapeError(`The hook line is ${hookWords} words; this format's hook is spoken in a ${win.toFixed(1)} s window, max ${limit} words.${hint} Or pass a shorter --hook-line.`);
    }
    const early = checkOriginality([{ path: "hook line", text: hookLine }], sourceText);
    if (early.errors.length) throw new MixtapeError(early.errors.join("\n"));
  }
  const register = opts.register ? findRegister(p.root, opts.register) : null;

  const id = newJobId(`${label}-press`);
  const dir = join(p.jobs("press"), id);
  mkdirSync(dir, { recursive: true });
  const job: PressJob = {
    id,
    created: new Date().toISOString(),
    ref: label,
    brief,
    hookLine,
    candidates,
    // --style, else the account's default look (renders/account.json), else Claude proposes one.
    style: opts.style?.trim() || account.style_default || null,
    styleRef: opts.styleRef?.trim() || null,
    imperfect: parseImperfect(opts),
    wordsPerSecond,
    register,
  };
  writeFileSync(join(dir, "job.json"), JSON.stringify(job, null, 2) + "\n");
  writeFileSync(join(dir, "structure.json"), JSON.stringify(structure, null, 2) + "\n");

  const answerPath = join(dir, "answer.json");
  const promptPath = join(dir, "prompt.md");
  writeFileSync(
    promptPath,
    buildPressPrompt({ structure, brief, hookLine, style: job.style, captionsOnly: isCaptionsOnly(structure.audio.voice), wordsPerSecond, register, answerPath, finishCommand: `mixtape press --finish ${id}` }),
  );
  if (opts.quiet) return { id };
  out(`press job ${id}  (${structure.format}, ${structure.beats.length} beats, ${structure.duration_s} s${register ? `, register ${register.id}` : ""})`);
  out(`  hook: ${hookLine ?? `(written in the answer: ${structure.hook.pattern}, max ${limit} words)`}`);
  out(`  prompt: ${rel(p, promptPath)}`);
  out(`  answer: ${rel(p, answerPath)}`);
  out(`\nNext: answer the prompt, then run  mixtape press --finish ${id}`);
  return { id };
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

/** The hook rules `mixtape hook --finish` applies, for a hook written inside a press answer. */
function hookLineErrors(line: string, structure: Structure, sourceText: string, wps: number | undefined): string[] {
  const errors: string[] = [];
  if (line.length > 160) errors.push("hook.line: too long (160 characters max)");
  const limit = hookWordLimit(structure, wps);
  const n = words(line).length;
  if (n > limit) errors.push(`hook.line: ${n} words; this format's hook window takes max ${limit}`);
  const brand = structure.source.kind === "meta" ? structure.source.page_name : "";
  if (mentionsName(line, brand)) errors.push("hook.line: names the source brand");
  const run = sourceText ? longestSharedRun(line, sourceText, HOOK_MAX_SHARED_RUN) : null;
  if (run) errors.push(`hook.line: shares ${run.length} words in a row with the source ad ("${run.run}")`);
  const near = !run && sourceText ? nearCopy(line, sourceText) : null;
  if (near) errors.push(`hook.line: near-copy of a source line (${Math.round(near.ratio * 100)}% of its words in order); rewrite it`);
  return errors;
}

export interface PressFinishResult {
  ok: boolean;
  errors: string[];
  outPath?: string;
  script?: Script;
}

export function pressFinish(id: string, opts: PressOptions, p: Paths = projectPaths()): PressFinishResult {
  assertJobId(id, "press");
  const dir = join(p.jobs("press"), id);
  if (!existsSync(join(dir, "job.json"))) throw new MixtapeError(`No press job ${id} in ${rel(p, p.jobs("press"))}.`);
  const job = jobSchema.parse(JSON.parse(readFileSync(join(dir, "job.json"), "utf8")));
  const structure = structureSchema.parse(JSON.parse(readFileSync(join(dir, "structure.json"), "utf8")));

  const answerPath = opts.answer ? resolve(opts.answer) : join(dir, "answer.json");
  if (!existsSync(answerPath)) throw new MixtapeError(`No answer file at ${rel(p, answerPath)}. Answer ${rel(p, join(dir, "prompt.md"))} first.`);
  if (statSync(answerPath).size > MAX_ANSWER_BYTES) throw new MixtapeError("Answer file is too large (128 KB max).");
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(answerPath, "utf8"));
  } catch {
    return { ok: false, errors: ["answer is not valid JSON"] };
  }
  const a = answerSchema.safeParse(json);
  if (!a.success) return { ok: false, errors: formatIssues(a.error) };

  const errors: string[] = [];
  if (a.data.beats.length !== structure.beats.length) errors.push(`beats: expected ${structure.beats.length} beats, got ${a.data.beats.length}`);
  structure.beats.forEach((b, i) => {
    const got = a.data.beats[i];
    if (got && got.role !== b.role) errors.push(`beats.${i}.role: expected ${b.role} (the structure's order), got ${got.role}`);
  });
  const style = job.style ?? a.data.style_prompt?.trim() ?? "";
  if (!style) errors.push("style_prompt: required (no --style was given)");

  // The hook line: fixed by the job, or written in the answer (then held to the hook rules: window, brand, 5+ word runs).
  const sourceText = cachedSourceText(p.root, cacheIdOf(structure));
  const written = a.data.hook.line?.trim() ?? "";
  let hookLine = job.hookLine ?? "";
  if (job.hookLine === null) {
    if (!written) errors.push("hook.line: required (no hook was chosen for this press job; write it)");
    else errors.push(...hookLineErrors(written, structure, sourceText, job.wordsPerSecond));
    hookLine = written;
  } else if (written && written !== job.hookLine) errors.push("hook.line: the hook is fixed for this job; leave it out or repeat it exactly");

  // --register: the monologue is the writer's unit; the split must add back up to it, word for word.
  if (job.register) {
    const mono = a.data.monologue?.trim();
    if (!mono) errors.push(`monologue: required with register ${job.register.id} (write the whole ad as one monologue, then split it)`);
    else {
      const joined = [hookLine, ...a.data.beats.map((b) => b.line)].map((l) => l.trim()).filter(Boolean).join(" ");
      if (norm(mono) !== norm(joined)) errors.push("monologue: the hook line and beat lines joined by spaces must be the monologue word for word (edit the monologue, then re-split)");
    }
  }
  if (errors.length) return { ok: false, errors };

  const candidate = {
    brief: job.brief,
    structure: { ref: job.ref, format: structure.format, source: structure.source, duration_s: structure.duration_s, aspect: structure.aspect },
    hook: { t: structure.hook.t, pattern: structure.hook.pattern, line: hookLine, visual: a.data.hook.visual, shot: a.data.hook.shot },
    hook_candidates: job.candidates,
    beats: structure.beats.map((b, i) => {
      const got = a.data.beats[i];
      return { t: b.t, role: b.role, line: got?.line ?? "", visual: got?.visual ?? "", shot: got?.shot };
    }),
    cast: a.data.cast,
    wardrobe: a.data.wardrobe,
    sets: a.data.sets,
    style_lock: { style_prompt: style, reference_image: job.styleRef },
    audio: {
      music: structure.audio.music,
      sfx: structure.audio.sfx,
      voice: structure.audio.voice,
      ...(job.register ? { register: job.register.id, ...(job.register.tag ? { delivery_tag: job.register.tag } : {}) } : {}),
    },
    checks: { overlap_passed: false, max_overlap_words: 0, timing_within_10pct: false, claims_in_brief: false },
  };
  const parsed = scriptSchema.safeParse(candidate);
  if (!parsed.success) return { ok: false, errors: formatIssues(parsed.error) };

  const audit = auditScript(parsed.data, sourceText, job.wordsPerSecond);
  if (audit.errors.length) return { ok: false, errors: audit.errors };

  // The imperfection layer goes on after the audit: the writer's clean lines are what the timing and
  // claims checks judge; the fillers, restarts and tags are performance, added over the whole ad as
  // one monologue (never the hook's first clause, never the last line).
  const imp = parseImperfect(opts) ?? job.imperfect ?? null;
  let script: Script = { ...parsed.data, checks: audit.checks };
  if (imp && imp.rate > 0) {
    const touched = imperfectLines([script.hook.line, ...script.beats.map((b) => b.line)], imp);
    script = {
      ...script,
      hook: { ...script.hook, line: touched.lines[0] ?? script.hook.line },
      beats: script.beats.map((b, i) => ({ ...b, line: touched.lines[i + 1] ?? b.line })),
      audio: { ...script.audio, imperfect: imp },
    };
  }
  const outPath = opts.out ? resolve(opts.out) : join(p.root, "data", "scripts", `${id}.script.json`);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(script, null, 2) + "\n");
  return { ok: true, errors: [], outPath, script };
}

export async function pressCommand(input: string | undefined, brief: string | undefined, opts: PressOptions): Promise<number> {
  const p = projectPaths();
  if (opts.finish) {
    const r = pressFinish(opts.finish, opts, p);
    if (!r.ok) {
      out(`script rejected (${r.errors.length} problem${r.errors.length === 1 ? "" : "s"}); nothing saved:`);
      for (const e of r.errors) out(`  - ${e}`);
      return 1;
    }
    const s = r.script as Script;
    out(`script.json saved: ${rel(p, r.outPath as string)}`);
    out(`  ${s.structure.format} · ${s.beats.length} beats · ${s.structure.duration_s} s · longest shared run ${s.checks.max_overlap_words} words${s.audio.register ? ` · register ${s.audio.register}` : ""}`);
    out(`  ${s.hook.line}`);
    for (const b of s.beats) out(`  [${b.role}] ${b.line}`);
    return 0;
  }
  if (!input) throw new MixtapeError('Give a structure (file or F1-F14) and a brief: mixtape press <structure> "<brief>".');
  await pressPrep(input, brief, opts, p);
  return 0;
}
