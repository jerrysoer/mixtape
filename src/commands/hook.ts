import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { z } from "zod";
import { buildHookPrompt } from "../claude/prompts/hook.js";
import { loadConfig, type Config } from "../config.js";
import { loadFormat } from "../formats.js";
import { hookWordLimit } from "../guard/script.js";
import { HOOK_KEEP, checkHooks, type ScoredHook } from "../hooks/score.js";
import { templateHooks } from "../hooks/templates.js";
import { MixtapeError, out } from "../lib/io.js";
import { assertJobId, cachedSourceText, newJobId, projectPaths, type Paths } from "../lib/jobs.js";
import { exec } from "../media/exec.js";
import { formatIssues, structureSchema, type Structure } from "../schema/structure.js";

const MAX_ANSWER_BYTES = 64 * 1024;
const MAX_STRUCTURE_BYTES = 256 * 1024;

export interface HookOptions {
  topic?: string;
  offline?: boolean;
  finish?: string;
  answer?: string;
  out?: string;
}

const jobSchema = z.object({
  id: z.string(),
  created: z.string(),
  input: z.string(),
  topic: z.string(),
});

export interface HookJob {
  id: string;
  /** Who wrote the candidates: Claude Code (prompt written, answer pending), AutoHook, or templates. */
  engine: "claude" | "autohook" | "templates";
  /** Set when candidates were written straight away (autohook, templates). */
  outPath?: string;
}

function rel(p: Paths, abs: string): string {
  return relative(p.root, abs) || ".";
}

/** A structure file path, or a built-in format id (F1-F14). */
export function loadStructure(input: string): { structure: Structure; label: string } {
  if (/^f\d{1,3}$/i.test(input.trim())) return { structure: loadFormat(input), label: input.trim().toUpperCase() };
  const abs = resolve(input);
  if (!existsSync(abs) || !statSync(abs).isFile()) throw new MixtapeError(`No structure file at ${input} (or use a format id like F3).`);
  if (statSync(abs).size > MAX_STRUCTURE_BYTES) throw new MixtapeError("That structure file is too large.");
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(abs, "utf8"));
  } catch {
    throw new MixtapeError(`${input} is not valid JSON.`);
  }
  const r = structureSchema.safeParse(json);
  if (!r.success) throw new MixtapeError(`${input} is not a valid structure.json:\n  ${formatIssues(r.error).join("\n  ")}`);
  return { structure: r.data, label: basename(abs).replace(/\.structure\.json$|\.json$/, "") };
}

function brandOf(s: Structure): string {
  return s.source.kind === "meta" ? s.source.page_name : "";
}

function cacheIdOf(s: Structure): string | undefined {
  return s.source.kind === "template" ? undefined : s.source.cache_id;
}

function withCandidates(s: Structure, candidates: string[]): Structure {
  return structureSchema.parse({ ...s, hook: { ...s.hook, candidates: candidates.slice(0, HOOK_KEEP) } });
}

function save(p: Paths, outPath: string | undefined, id: string, s: Structure): string {
  const file = outPath ? resolve(outPath) : join(p.structures, `${id}.structure.json`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(s, null, 2) + "\n");
  return file;
}

/**
 * AutoHook contract (DECISIONS 2026-11-06): Mixtape runs `$AUTOHOOK_PATH <structure.json> --topic <topic>`
 * with no shell; AutoHook fills `hook.candidates` in that file and exits 0. Mixtape re-validates and keeps 5.
 */
async function runAutoHook(bin: string, structureFile: string, topic: string): Promise<string[]> {
  await exec(resolve(bin), [structureFile, "--topic", topic], { timeoutMs: 300_000 });
  const r = structureSchema.safeParse(JSON.parse(readFileSync(structureFile, "utf8")));
  if (!r.success) throw new MixtapeError("AutoHook wrote an invalid structure.json.");
  if (r.data.hook.candidates.length === 0) throw new MixtapeError("AutoHook returned no candidates.");
  return r.data.hook.candidates;
}

export async function hookPrep(input: string, opts: HookOptions, p: Paths = projectPaths(), config: Config = loadConfig(p.root)): Promise<HookJob> {
  const topic = (opts.topic ?? "").trim();
  if (topic.length < 2) throw new MixtapeError('Give the new ad\'s topic: --topic "<product or idea>".');
  if (topic.length > 300) throw new MixtapeError("--topic is too long (300 chars max).");
  const { structure, label } = loadStructure(input);
  const id = newJobId(`${label}-${topic}`);
  const dir = join(p.jobs("hook"), id);
  mkdirSync(dir, { recursive: true });
  const structureFile = join(dir, "structure.json");
  writeFileSync(structureFile, JSON.stringify(structure, null, 2) + "\n");
  writeFileSync(join(dir, "job.json"), JSON.stringify({ id, created: new Date().toISOString(), input: label, topic }, null, 2) + "\n");

  if (opts.offline) {
    const outPath = save(p, opts.out, id, withCandidates(structure, templateHooks(structure.hook.pattern, topic)));
    out(`hook (offline templates, ${structure.hook.pattern}): ${rel(p, outPath)}`);
    return { id, engine: "templates", outPath };
  }

  if (config.AUTOHOOK_PATH) {
    const scratch = join(dir, "autohook.structure.json");
    copyFileSync(structureFile, scratch);
    try {
      const candidates = await runAutoHook(config.AUTOHOOK_PATH, scratch, topic);
      const outPath = save(p, opts.out, id, withCandidates(structure, candidates));
      out(`hook (AutoHook): ${rel(p, outPath)}`);
      return { id, engine: "autohook", outPath };
    } catch (e) {
      out(`  warn: AutoHook failed (${e instanceof Error ? e.message : "unknown"}); writing the Claude prompt instead.`);
    }
  }

  const answerPath = join(dir, "answer.json");
  const promptPath = join(dir, "prompt.md");
  writeFileSync(promptPath, buildHookPrompt(structure, topic, answerPath, `mixtape hook --finish ${id}`));
  out(`hook job ${id}  (${structure.format} · ${structure.hook.pattern})`);
  out(`  prompt: ${rel(p, promptPath)}`);
  out(`  answer: ${rel(p, answerPath)}`);
  out(`\nNext: answer the prompt, then run  mixtape hook --finish ${id}`);
  return { id, engine: "claude" };
}

export interface HookFinishResult {
  ok: boolean;
  errors: string[];
  outPath?: string;
  hooksPath?: string;
  ranked?: ScoredHook[];
}

export function hookFinish(id: string, opts: HookOptions, p: Paths = projectPaths()): HookFinishResult {
  assertJobId(id, "hook");
  const dir = join(p.jobs("hook"), id);
  if (!existsSync(join(dir, "job.json"))) throw new MixtapeError(`No hook job ${id} in ${rel(p, p.jobs("hook"))}.`);
  const job = jobSchema.parse(JSON.parse(readFileSync(join(dir, "job.json"), "utf8")));
  const structure = structureSchema.parse(JSON.parse(readFileSync(join(dir, "structure.json"), "utf8")));

  const answerPath = opts.answer ? resolve(opts.answer) : join(dir, "answer.json");
  if (!existsSync(answerPath)) throw new MixtapeError(`No answer file at ${rel(p, answerPath)}. Answer ${rel(p, join(dir, "prompt.md"))} first.`);
  if (statSync(answerPath).size > MAX_ANSWER_BYTES) throw new MixtapeError("Answer file is too large (64 KB max).");
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(answerPath, "utf8"));
  } catch {
    return { ok: false, errors: ["answer is not valid JSON"] };
  }

  const r = checkHooks(json, { sourceText: cachedSourceText(p.root, cacheIdOf(structure)), brand: brandOf(structure), maxWords: hookWordLimit(structure) });
  if (r.errors.length) return { ok: false, errors: r.errors };

  const outPath = save(p, opts.out, id, withCandidates(structure, r.top.map((h) => h.text)));
  const hooksPath = outPath.replace(/(\.structure)?\.json$/, ".hooks.json");
  writeFileSync(hooksPath, JSON.stringify({ topic: job.topic, structure: job.input, pattern: structure.hook.pattern, ranked: r.ranked }, null, 2) + "\n");
  return { ok: true, errors: [], outPath, hooksPath, ranked: r.ranked };
}

export async function hookCommand(input: string | undefined, opts: HookOptions): Promise<number> {
  const p = projectPaths();
  if (opts.finish) {
    const r = hookFinish(opts.finish, opts, p);
    if (!r.ok) {
      out(`hooks rejected (${r.errors.length} problem${r.errors.length === 1 ? "" : "s"}); nothing saved:`);
      for (const e of r.errors) out(`  - ${e}`);
      return 1;
    }
    out(`structure.json with ${HOOK_KEEP} hooks saved: ${rel(p, r.outPath as string)}`);
    out(`  all ${r.ranked?.length ?? 0} scored: ${rel(p, r.hooksPath as string)}\n`);
    out("  score  scr cur fit  hook");
    (r.ranked ?? []).forEach((h, i) => {
      out(`  ${i < HOOK_KEEP ? "*" : " "}${h.score.toFixed(2).padStart(5)}  ${String(h.scroll).padStart(3)} ${String(h.curiosity).padStart(3)} ${String(h.fit).padStart(3)}  ${h.text}`);
    });
    return 0;
  }
  if (!input) throw new MixtapeError('Give a structure: a .structure.json file or a format id (F1-F14), plus --topic "<topic>".');
  await hookPrep(input, opts, p);
  return 0;
}
