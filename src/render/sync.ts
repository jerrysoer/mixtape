import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { exec } from "../media/exec.js";

/**
 * Lip-sync, rule 0 (showrun references/lip-sync.md): the locked ElevenLabs line is the master.
 * 1. The audio ref a speaking clip gets is TIGHT: speech starts within 0.2 s of 0:00, a short
 *    closed-mouth tail, nothing else.
 * 2. After Seedance returns, the clip's own speech span is compared with the take's: 0.85–1.18x
 *    passes, anything else is a sync fail (one retake, then the still).
 * 3. The clip is then line-locked onto the take: ONE speed (0.9–1.1x) and offset per clip, so its
 *    mouth lands where the ElevenLabs words are; the clip's audio is dropped, the take plays.
 * Whisper word times are never used for the warp (0.2–0.7 s off); this uses the speech envelope.
 */

export const SYNC_MIN = 0.85;
export const SYNC_MAX = 1.18;
export const SPEED_MIN = 0.9;
export const SPEED_MAX = 1.1;
/** Silence threshold and minimum gap for the envelope (dB, s). */
const SILENCE_DB = -35;
const SILENCE_S = 0.2;
/** Lead before the first word and tail after the last in the audio ref (s). */
export const REF_LEAD_S = 0.1;
export const REF_TAIL_S = 0.4;

export interface Span {
  start: number;
  end: number;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** First speech start and last speech end in a media file, from ffmpeg silencedetect; null when nothing is heard. */
export async function speechSpan(file: string): Promise<Span | null> {
  const probe = await exec("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file], { timeoutMs: 15_000 });
  const duration = Number(probe.stdout.trim());
  const { stderr } = await exec(
    "ffmpeg",
    ["-hide_banner", "-nostats", "-nostdin", "-i", file, "-vn", "-af", `silencedetect=noise=${SILENCE_DB}dB:d=${SILENCE_S}`, "-f", "null", "-"],
    { timeoutMs: 120_000 },
  );
  const starts = [...stderr.matchAll(/silence_start: ([\d.]+)/g)].map((m) => Number(m[1]));
  const ends = [...stderr.matchAll(/silence_end: ([\d.]+)/g)].map((m) => Number(m[1]));
  if (!Number.isFinite(duration) || duration <= 0) return null;
  // Speech = the complement of the silences. A silence from 0 pushes the start; a silence that runs to
  // the end (ffmpeg reports its silence_end at EOF, or not at all) pulls the end in.
  const silences = starts.map((s, i) => ({ start: s, end: ends[i] ?? duration }));
  let start = 0;
  let end = duration;
  const first = silences[0];
  if (first && first.start <= 0.05) start = first.end;
  const last = silences.at(-1);
  if (last && last.end >= duration - 0.05 && last.start > start) end = last.start;
  if (end - start <= 0.05) return null;
  return { start: r3(start), end: r3(end) };
}

/**
 * Write the tight audio ref for one line: leading silence cut to REF_LEAD_S, REF_TAIL_S of silence
 * after the last word, mono 48 kHz. With `padTo` (the clip's length) the ref is extended with
 * silence to exactly that length, so the model has a timing track for the whole clip and no room to
 * move the line (live 2026-11-07: a 2.4 s ref in a 4 s clip was re-timed to start at 2.47 s).
 */
export async function tightRef(lineWav: string, out: string, padTo?: number): Promise<{ file: string; span: Span; seconds: number }> {
  const span = await speechSpan(lineWav);
  if (!span) throw new Error(`no speech heard in ${lineWav}`);
  mkdirSync(dirname(out), { recursive: true });
  const from = Math.max(0, span.start - REF_LEAD_S);
  const to = span.end + REF_TAIL_S;
  const seconds = r3(padTo !== undefined ? Math.max(to - from, padTo) : to - from);
  await exec("ffmpeg", ["-hide_banner", "-nostdin", "-loglevel", "error", "-y", "-i", lineWav, "-af", `atrim=start=${from.toFixed(3)}:end=${to.toFixed(3)},asetpts=PTS-STARTPTS,apad=whole_dur=${seconds.toFixed(3)}`, "-t", seconds.toFixed(3), "-ac", "1", "-ar", "48000", "-c:a", "pcm_s16le", out], { timeoutMs: 60_000 });
  return { file: out, span: { start: r3(span.start - from), end: r3(span.end - from) }, seconds };
}

export interface SyncVerdict {
  /** clip speech span / take speech span. */
  ratio: number;
  /** Where the clip's speech starts (s into the clip). */
  clipStart: number;
  pass: boolean;
  why: string;
}

/** Rule 0 step 4: the clip's speech must run 0.85–1.18x the take's. */
export function judgeSync(clip: Span | null, take: Span): SyncVerdict {
  if (!clip) return { ratio: 0, clipStart: 0, pass: false, why: "no speech heard in the clip" };
  const ratio = r3((clip.end - clip.start) / Math.max(0.05, take.end - take.start));
  const pass = ratio >= SYNC_MIN && ratio <= SYNC_MAX;
  return { ratio, clipStart: clip.start, pass, why: pass ? "" : `speech ran ${ratio}x the take (allowed ${SYNC_MIN}–${SYNC_MAX}x)` };
}

export interface Fit {
  /** Seconds trimmed from the clip's head so its first word lands on the take's first word. */
  trimStart: number;
  /** Playback speed applied to the clip (1 = as is; <1 slows it down). */
  speed: number;
}

/**
 * Line-lock (rule 0 step 5): one speed and offset. The take plays at `takeStartInShot` seconds into
 * the shot; the clip is sped by ratio (clamped 0.9–1.1) so its speech span matches the take's, then
 * trimmed so its first word lands on the take's first word.
 */
export function lineLock(v: SyncVerdict, takeStartInShot: number): Fit {
  const speed = Math.min(SPEED_MAX, Math.max(SPEED_MIN, v.ratio || 1));
  // After speeding by `speed`, the clip's speech starts at clipStart/speed; it must start at takeStartInShot.
  const trimStart = Math.max(0, r3(v.clipStart - takeStartInShot * speed));
  return { trimStart, speed: r3(speed) };
}
