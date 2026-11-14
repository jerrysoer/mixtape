import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, extname, join, relative, resolve } from "node:path";
import { z } from "zod";
import { buildBreakPrompt } from "../claude/prompts/break.js";
import { loadConfig, type Config } from "../config.js";
import { longestSharedRun, mentionsName, nearCopy, quotedSpans } from "../guard/overlap.js";
import { MixtapeError, out } from "../lib/io.js";
import { JOB_ID, newJobId } from "../lib/jobs.js";
import { MAX_DOWNLOAD_BYTES, downloadVideo, safeHost } from "../media/download.js";
import { contactSheet, extractFrames, pickFrameTimes } from "../media/keyframes.js";
import { nearestAspect, probe } from "../media/probe.js";
import { detectScenes, type Scene } from "../media/scenes.js";
import { EMPTY_TRANSCRIPT, suppliedTranscript, transcribe, type Transcript } from "../media/transcribe.js";
import {
  ASPECTS,
  MAX_DURATION_S,
  RULES_TEXT,
  audioSchema,
  beatSchema,
  describedText,
  formatIssues,
  hookSchema,
  sourceSchema,
  structureSchema,
  type Structure,
  type StructureSource,
} from "../schema/structure.js";
import { parseMetaAd, pickAd } from "../sources/metaAd.js";

/** structure.json may not share a run of this many words with the source (stricter than the script guard's 7). */
export const STRUCTURE_MAX_SHARED_RUN = 5;
const QUOTE_MIN_WORDS = 4;
const MAX_ANSWER_BYTES = 64 * 1024;
const VIDEO_EXT = new Set([".mp4", ".mov", ".m4v", ".webm", ".mkv"]);

export interface BreakPaths {
  root: string;
  jobs: string;
  sources: string;
  structures: string;
}

export function breakPaths(root: string = process.cwd()): BreakPaths {
  return { root, jobs: join(root, ".cache", "break"), sources: join(root, ".cache", "sources"), structures: join(root, "data", "structures") };
}

const jobSchema = z.object({
  id: z.string().regex(JOB_ID),
  created: z.string(),
  source: sourceSchema,
  sourceLabel: z.string(),
  duration_s: z.number().positive().max(MAX_DURATION_S),
  aspect: z.enum(ASPECTS),
  media: z.string().nullable(),
  scenes: z.array(z.object({ t: z.tuple([z.number(), z.number()]) })),
  frames: z.array(z.object({ t: z.number(), file: z.string() })),
  transcriptEngine: z.string(),
  hasAdCopy: z.boolean(),
});
type Job = z.infer<typeof jobSchema>;

/** What Claude writes: the structure minus the fields the CLI owns. */
const answerSchema = z
  .object({
    format: z.string(),
    hook: hookSchema.omit({ candidates: true }).extend({ candidates: z.array(z.string()).max(10).optional() }),
    beats: z.array(beatSchema),
    audio: audioSchema,
  })
  .strict();

export interface BreakOptions {
  describe?: string;
  transcript?: string;
  duration?: string;
  ad?: string;
  finish?: string;
  answer?: string;
  out?: string;
}

function rel(p: BreakPaths, abs: string): string {
  return relative(p.root, abs) || ".";
}

function readJob(p: BreakPaths, id: string): Job {
  if (!JOB_ID.test(id)) throw new MixtapeError(`"${id}" is not a break job id.`);
  const file = join(p.jobs, id, "job.json");
  if (!existsSync(file)) throw new MixtapeError(`No break job ${id} in ${rel(p, p.jobs)}.`);
  return jobSchema.parse(JSON.parse(readFileSync(file, "utf8")));
}

function readTranscript(p: BreakPaths, id: string): Transcript {
  const file = join(p.jobs, id, "transcript.json");
  return existsSync(file) ? (JSON.parse(readFileSync(file, "utf8")) as Transcript) : EMPTY_TRANSCRIPT;
}

// ───────────────────────── prep ─────────────────────────

interface Resolved {
  hint: string;
  source: StructureSource;
  sourceLabel: string;
  media: { kind: "file"; path: string } | { kind: "url"; url: string } | null;
  adCopy?: string;
}

function resolveSource(input: string | undefined, opts: BreakOptions): Resolved {
  if (opts.describe !== undefined) {
    if (input) throw new MixtapeError("Use either a source or --describe, not both.");
    if (opts.describe.trim().length < 10) throw new MixtapeError("--describe needs a sentence or more about the format.");
    return { hint: "describe", source: { kind: "describe" }, sourceLabel: "described by the user (no video)", media: null };
  }
  if (!input) throw new MixtapeError('Give a source: a video file, an https link, a saved ad .json, or --describe "<format>".');

  if (/^https?:\/\//i.test(input)) {
    const host = safeHost(input);
    return { hint: host.split(".").slice(-2, -1)[0] ?? "link", source: { kind: "link", host }, sourceLabel: `link on ${host}`, media: { kind: "url", url: input } };
  }

  const abs = resolve(input);
  if (!existsSync(abs) || !statSync(abs).isFile()) throw new MixtapeError(`No file at ${input}.`);
  const ext = extname(abs).toLowerCase();

  if (ext === ".json") {
    if (statSync(abs).size > 20 * 1024 * 1024) throw new MixtapeError("That JSON file is too large.");
    const ad = parseMetaAd(pickAd(JSON.parse(readFileSync(abs, "utf8")), opts.ad));
    const url = ad.videoUrls[0];
    if (!url) throw new MixtapeError(`Ad ${ad.adId} has no video. Image and carousel ads are not supported by break yet.`);
    return {
      hint: ad.adId,
      source: { platform: "meta", kind: "meta", ad_id: ad.adId, page_name: ad.pageName, days_running: ad.daysRunning, variants: ad.variants },
      sourceLabel: `Meta ad ${ad.adId} from ${ad.pageName}, running ${ad.daysRunning} days, ${ad.variants} variant(s)`,
      media: { kind: "url", url },
      adCopy: ad.adCopy,
    };
  }

  if (!VIDEO_EXT.has(ext)) throw new MixtapeError(`Unsupported file type ${ext}. Use ${[...VIDEO_EXT].join(", ")} or a saved ad .json.`);
  if (statSync(abs).size > MAX_DOWNLOAD_BYTES) throw new MixtapeError("That video is larger than 250 MB.");
  const name = basename(abs);
  return { hint: name.replace(/\.[^.]+$/, ""), source: { kind: "upload", file_name: name }, sourceLabel: `uploaded file ${name}`, media: { kind: "file", path: abs } };
}

export async function breakPrep(input: string | undefined, opts: BreakOptions, p: BreakPaths = breakPaths(), config: Config = loadConfig(p.root)): Promise<Job> {
  const r = resolveSource(input, opts);
  const id = newJobId(r.hint);
  const jobDir = join(p.jobs, id);
  const framesDir = join(jobDir, "frames");
  mkdirSync(framesDir, { recursive: true });
  mkdirSync(p.sources, { recursive: true });

  let duration_s: number;
  let aspect: Job["aspect"] = "9:16";
  let media: string | null = null;
  let scenes: Scene[] = [];
  let frames: { t: number; file: string }[] = [];
  let sheet: string | null = null;
  let transcript: Transcript = opts.transcript ? suppliedTranscript(readFileSync(resolve(opts.transcript), "utf8")) : EMPTY_TRANSCRIPT;

  if (r.media) {
    const ext = r.media.kind === "file" ? extname(r.media.path).toLowerCase() : ".mp4";
    media = join(p.sources, `${id}${ext}`);
    if (r.media.kind === "file") {
      copyFileSync(r.media.path, media);
    } else {
      out(`  downloading from ${safeHost(r.media.url)} …`);
      await downloadVideo(r.media.url, media);
    }
    const info = await probe(media);
    if (info.duration_s > MAX_DURATION_S) throw new MixtapeError(`Video is ${info.duration_s} s; break handles up to ${MAX_DURATION_S} s.`);
    duration_s = info.duration_s;
    aspect = nearestAspect(info.width, info.height);
    out(`  ${duration_s} s, ${info.width}x${info.height} (${aspect}); finding scene cuts …`);
    scenes = await detectScenes(media, duration_s);
    frames = await extractFrames(media, pickFrameTimes(scenes, duration_s), framesDir);
    sheet = await contactSheet(framesDir, frames.length, join(jobDir, "sheet.jpg")).catch(() => null);
    if (!opts.transcript && info.hasAudio) {
      out("  transcribing (stays in .cache) …");
      try {
        transcript = await transcribe(media, jobDir, config);
      } catch (e) {
        out(`  warn: transcript failed (${e instanceof Error ? e.message : "unknown"}); continuing without one.`);
      }
      if (transcript.engine === "none") out("  warn: no transcriber found; the prompt asks Claude to read words from the frames.");
    }
  } else {
    duration_s = opts.duration ? Number(opts.duration) : 20;
    if (!Number.isFinite(duration_s) || duration_s < 5 || duration_s > MAX_DURATION_S) throw new MixtapeError(`--duration must be 5-${MAX_DURATION_S} seconds.`);
  }

  const source = { ...r.source, cache_id: id } as StructureSource;
  const job: Job = {
    id,
    created: new Date().toISOString(),
    source,
    sourceLabel: r.sourceLabel,
    duration_s,
    aspect,
    media: media ? rel(p, media) : null,
    scenes,
    frames: frames.map((f) => ({ t: f.t, file: rel(p, f.file) })),
    transcriptEngine: transcript.engine,
    hasAdCopy: Boolean(r.adCopy),
  };
  writeFileSync(join(jobDir, "job.json"), JSON.stringify(job, null, 2) + "\n");
  writeFileSync(join(jobDir, "transcript.json"), JSON.stringify(transcript, null, 2) + "\n");
  if (r.adCopy) writeFileSync(join(jobDir, "ad_copy.txt"), r.adCopy);

  const answerPath = join(jobDir, "answer.json");
  const prompt = buildBreakPrompt({
    jobId: id,
    sourceLabel: r.sourceLabel,
    duration_s,
    aspect,
    scenes,
    frames,
    sheet,
    transcript,
    adCopy: r.adCopy,
    description: opts.describe,
    answerPath,
    finishCommand: `mixtape break --finish ${id}`,
  });
  const promptPath = join(jobDir, "prompt.md");
  writeFileSync(promptPath, prompt);

  out(`\nbreak job ${id}`);
  out(`  ${scenes.length} scene(s), ${frames.length} frame(s), transcript: ${transcript.engine}${transcript.text ? ` (${transcript.text.split(/\s+/).length} words)` : ""}`);
  out(`  prompt: ${rel(p, promptPath)}`);
  out(`  answer: ${rel(p, answerPath)}`);
  out(`\nNext: answer the prompt, then run  mixtape break --finish ${id}`);
  return job;
}

// ───────────────────────── finish ─────────────────────────

export interface FinishResult {
  ok: boolean;
  errors: string[];
  outPath?: string;
  structure?: Structure;
}

/** Validate Claude's answer against the schema, the timeline and the no-source-lines rule. */
export function checkAnswer(job: Job, answerJson: unknown, transcript: Transcript, adCopy: string): { errors: string[]; structure?: Structure } {
  const a = answerSchema.safeParse(answerJson);
  if (!a.success) return { errors: formatIssues(a.error) };
  const candidate = {
    source: job.source,
    duration_s: job.duration_s,
    aspect: job.aspect,
    format: a.data.format,
    hook: { ...a.data.hook, candidates: [] },
    beats: a.data.beats,
    audio: a.data.audio,
    rules: RULES_TEXT,
  };
  const s = structureSchema.safeParse(candidate);
  if (!s.success) return { errors: formatIssues(s.error) };

  const errors: string[] = [];
  const sourceText = [transcript.text, adCopy].filter(Boolean).join("\n");
  const brand = job.source.kind === "meta" ? job.source.page_name : "";
  for (const { path, text } of describedText(s.data)) {
    if (mentionsName(text, brand)) errors.push(`${path}: names the source brand; describe the pattern without it`);
    for (const q of quotedSpans(text, QUOTE_MIN_WORDS)) errors.push(`${path}: quotes a line ("${q.slice(0, 40)}…"); describe what it does instead`);
    const run = sourceText ? longestSharedRun(text, sourceText, STRUCTURE_MAX_SHARED_RUN) : null;
    if (run) errors.push(`${path}: shares ${run.length} words in a row with the source ("${run.run}"); describe, don't copy`);
    const near = !run && sourceText ? nearCopy(text, sourceText) : null;
    if (near) errors.push(`${path}: near-copy of a source line (${Math.round(near.ratio * 100)}% of its words in order); describe, don't copy`);
  }
  return errors.length ? { errors } : { errors: [], structure: s.data };
}

export function breakFinish(id: string, opts: BreakOptions, p: BreakPaths = breakPaths()): FinishResult {
  const job = readJob(p, id);
  const answerPath = opts.answer ? resolve(opts.answer) : join(p.jobs, id, "answer.json");
  if (!existsSync(answerPath)) throw new MixtapeError(`No answer file at ${rel(p, answerPath)}. Answer ${rel(p, join(p.jobs, id, "prompt.md"))} first.`);
  if (statSync(answerPath).size > MAX_ANSWER_BYTES) throw new MixtapeError("Answer file is too large (64 KB max).");
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(answerPath, "utf8"));
  } catch {
    return { ok: false, errors: ["answer is not valid JSON"] };
  }
  const adCopyFile = join(p.jobs, id, "ad_copy.txt");
  const adCopy = existsSync(adCopyFile) ? readFileSync(adCopyFile, "utf8") : "";
  const { errors, structure } = checkAnswer(job, json, readTranscript(p, id), adCopy);
  if (!structure) return { ok: false, errors };

  const outPath = opts.out ? resolve(opts.out) : join(p.structures, `${id}.structure.json`);
  mkdirSync(resolve(outPath, ".."), { recursive: true });
  writeFileSync(outPath, JSON.stringify(structure, null, 2) + "\n");
  return { ok: true, errors: [], outPath, structure };
}

// ───────────────────────── CLI entry ─────────────────────────

export async function breakCommand(input: string | undefined, opts: BreakOptions): Promise<number> {
  const p = breakPaths();
  if (opts.finish) {
    const r = breakFinish(opts.finish, opts, p);
    if (!r.ok) {
      out(`structure rejected (${r.errors.length} problem${r.errors.length === 1 ? "" : "s"}); nothing saved:`);
      for (const e of r.errors) out(`  - ${e}`);
      return 1;
    }
    const s = r.structure as Structure;
    out(`structure.json saved: ${rel(p, r.outPath as string)}`);
    out(`  ${s.format} · hook ${s.hook.pattern} · ${s.beats.map((b) => b.role).join(" → ")} · ${s.duration_s} s`);
    return 0;
  }
  await breakPrep(input, opts, p);
  return 0;
}
