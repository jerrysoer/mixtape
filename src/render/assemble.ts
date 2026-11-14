import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MixtapeError } from "../lib/io.js";
import { exec } from "../media/exec.js";
import type { Caption, ShotTime } from "./timeline.js";

/**
 * ffmpeg assembly (free): Ken Burns moves on each still, word captions and the end card drawn
 * with ImageMagick (this ffmpeg build has no drawtext/subtitles), narration normalised to -14 LUFS.
 */

export const W = 1080;
export const H = 1920;
export const FPS = 30;
export const LUFS = -14;
/** Off-white text on near-black stroke (no pure #fff/#000, CLAUDE.md design rules). */
const TEXT = "#FAF7F0";
const STROKE = "#141414";

export interface Look {
  font: string;
  /** Caption top edge, px from the top (default ~60% down, clear of the face area). */
  captionY?: number;
}

/**
 * ImageMagick treats a leading "@" as "read this file" and "%" as an escape in caption:/label:.
 * Script text is untrusted-ish (it came from a model), so neutralise both.
 */
export function escapeImText(text: string): string {
  const t = text.replace(/\\/g, "\\\\").replace(/%/g, "%%");
  return t.startsWith("@") ? `\\${t}` : t;
}

/**
 * Every caption-track image is written as 8-bit RGBA. ImageMagick otherwise saves a fully
 * transparent canvas as 1-bit greyscale with no alpha, which the concat demuxer drew as opaque
 * black after the last caption (regression test in assemble.test.ts, 2026-11-06).
 */
export function png32(file: string): string {
  return `PNG32:${file}`;
}

/** Integrated loudness (LUFS) and true peak (dBFS) from ffmpeg's ebur128 summary. */
export async function measureLoudness(file: string): Promise<{ i: number; peak: number }> {
  const { stderr } = await exec("ffmpeg", ["-hide_banner", "-nostats", "-nostdin", "-i", file, "-af", "ebur128=peak=true", "-f", "null", "-"], { timeoutMs: 120_000 });
  const summary = stderr.split("Summary:")[1] ?? "";
  const i = Number(/I:\s+(-?[\d.]+) LUFS/.exec(summary)?.[1]);
  const peak = Number(/Peak:\s+(-?[\d.]+) dBFS/.exec(summary)?.[1]);
  if (!Number.isFinite(i)) throw new MixtapeError(`Could not measure the loudness of ${file}.`);
  return { i, peak: Number.isFinite(peak) ? peak : 0 };
}

/** Sample limit ≈ -2.0 dBFS, which keeps the true peak under -1.5 dBTP. */
const LIMIT = 0.79;

/**
 * Narration to -14 LUFS under a -1.5 dBTP ceiling. ffmpeg's loudnorm can't do this for peaky
 * narration: when the linear gain would pass the peak ceiling it silently switches to dynamic mode
 * and lands short (ElevenLabs v3: -17.3 LUFS in, peaks -0.3 dBTP → -15.2 out, 2026-11-06).
 * Instead: exact gain + a limiter, re-measured and corrected until within 0.3 LU (4 tries max).
 */
export async function normalizeNarration(src: string, out: string): Promise<{ i: number; peak: number; gainDb: number }> {
  let gain = LUFS - (await measureLoudness(src)).i;
  let result = { i: 0, peak: 0 };
  for (let k = 0; k < 4; k++) {
    await exec("ffmpeg", ["-hide_banner", "-nostdin", "-loglevel", "error", "-y", "-i", src, "-af", `volume=${gain.toFixed(2)}dB,alimiter=limit=${LIMIT}:attack=5:release=50:level=disabled`, "-ar", "48000", "-c:a", "pcm_s16le", out], { timeoutMs: 120_000 });
    result = await measureLoudness(out);
    if (Math.abs(result.i - LUFS) <= 0.3) break;
    gain += LUFS - result.i;
  }
  return { ...result, gainDb: Math.round(gain * 100) / 100 };
}

/** A full-frame transparent PNG with outlined caption text. */
export async function captionPng(text: string, file: string, look: Look, opts: { y?: number; pointsize?: number } = {}): Promise<void> {
  const size = opts.pointsize ?? 96;
  const t = `caption:${escapeImText(text)}`;
  const layer = (stroke: boolean) => ["(", "-background", "none", "-font", look.font, "-pointsize", String(size), "-size", "940x", "-gravity", "center", "-fill", stroke ? STROKE : TEXT, "-stroke", stroke ? STROKE : "none", "-strokewidth", stroke ? "16" : "0", t, ")"];
  await exec(
    "magick",
    // Merge outline + fill inside one group first: with three images in the list, -composite reads the third as a mask.
    ["-size", `${W}x${H}`, "xc:none", "(", ...layer(true), ...layer(false), "-compose", "over", "-composite", ")", "-gravity", "north", "-geometry", `+0+${opts.y ?? look.captionY ?? 1150}`, "-composite", png32(file)],
    { timeoutMs: 30_000 },
  );
}

/** What the end card prints: the line without delivery tags ([laughs], [exhales]) or doubled spaces. */
export function cardText(line: string): string {
  return line.replace(/\[[^\]]*\]/g, " ").replace(/\s+/g, " ").trim();
}

/** End card: a rounded off-white panel in the top third with the offer line. */
export async function endCardPng(text: string, file: string, look: Look): Promise<void> {
  const t = `caption:${escapeImText(cardText(text))}`;
  await exec(
    "magick",
    [
      "-size", `${W}x${H}`, "xc:none",
      "-fill", "rgba(250,247,240,0.94)", "-draw", "roundrectangle 80,170 1000,560 40,40",
      "(", "-background", "none", "-font", look.font, "-pointsize", "88", "-size", "820x360", "-gravity", "center", "-fill", STROKE, t, ")",
      "-gravity", "north", "-geometry", "+0+185", "-composite", png32(file),
    ],
    { timeoutMs: 30_000 },
  );
}

/** One shot: scale-to-cover, then a slow push in (odd shots) or pull out (even shots). */
export function segmentArgs(still: string, seconds: number, index: number, out: string): string[] {
  const frames = Math.max(1, Math.round(seconds * FPS));
  const zoomIn = index % 2 === 0;
  const z = zoomIn ? `1+0.08*on/${frames}` : `1.08-0.08*on/${frames}`;
  // Upscale 2x before zoompan to avoid its integer-pixel jitter.
  const vf = [
    `scale=${W * 2}:${H * 2}:force_original_aspect_ratio=increase`,
    `crop=${W * 2}:${H * 2}`,
    `zoompan=z='${z}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${W}x${H}:fps=${FPS}`,
    "format=yuv420p",
  ].join(",");
  return ["-hide_banner", "-nostdin", "-loglevel", "error", "-y", "-i", still, "-vf", vf, "-frames:v", String(frames), "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-r", String(FPS), out];
}

/**
 * One shot from a Seedance clip (motion stage): cover-scale to 1080x1920, square pixels (Seedance
 * clips carry an odd SAR that breaks concat; showrun), hold the last frame if the clip runs short,
 * cut to the shot window, no clip audio (the narration track is the master).
 */
export interface ClipSegment {
  file: string;
  /** Line-lock fit (sync.ts): head trim and one playback speed; omitted = as is. */
  trimStart?: number;
  speed?: number;
}

export function clipSegmentArgs(clip: ClipSegment, seconds: number, out: string): string[] {
  const speed = clip.speed ?? 1;
  const vf = [
    ...(clip.trimStart ? [`trim=start=${clip.trimStart.toFixed(3)}`] : []),
    ...(speed !== 1 ? [`setpts=(PTS-STARTPTS)/${speed.toFixed(4)}`] : clip.trimStart ? ["setpts=PTS-STARTPTS"] : []),
    `scale=${W}:${H}:force_original_aspect_ratio=increase`,
    `crop=${W}:${H}`,
    "setsar=1",
    `fps=${FPS}`,
    `tpad=stop_mode=clone:stop_duration=${seconds.toFixed(3)}`,
    "format=yuv420p",
  ].join(",");
  return ["-hide_banner", "-nostdin", "-loglevel", "error", "-y", "-i", clip.file, "-an", "-vf", vf, "-t", seconds.toFixed(3), "-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-r", String(FPS), out];
}

/** concat-demuxer list for the caption track: caption PNGs with blank gaps, covering 0..total. */
export function captionTrackList(caps: { file: string; start: number; end: number }[], blank: string, total: number): string {
  const q = (f: string) => `file '${f.replace(/'/g, "'\\''")}'`;
  const lines: string[] = [];
  let cursor = 0;
  for (const c of caps) {
    const start = Math.max(c.start, cursor);
    const end = Math.min(c.end, total);
    if (end <= start) continue;
    if (start - cursor > 0.001) lines.push(q(blank), `duration ${(start - cursor).toFixed(3)}`);
    lines.push(q(c.file), `duration ${(end - start).toFixed(3)}`);
    cursor = end;
  }
  if (total - cursor > 0.001) lines.push(q(blank), `duration ${(total - cursor).toFixed(3)}`);
  lines.push(q(blank)); // the concat demuxer ignores the last duration unless the last file is repeated
  return lines.join("\n") + "\n";
}

export interface BuildInput {
  dir: string;
  stills: string[];
  /** Motion stage: a clip per shot, or null where the shot falls back to its still. */
  clips?: (ClipSegment | null)[];
  times: ShotTime[];
  captions: Caption[];
  endCard: { text: string; start: number; end: number } | null;
  narration: string | null;
  look: Look;
  out: string;
}

export async function buildCut(b: BuildInput): Promise<{ out: string; seconds: number }> {
  const work = join(b.dir, "build");
  mkdirSync(work, { recursive: true });
  const total = b.times.at(-1)?.end ?? 0;

  // 1. one segment per shot
  const segs: string[] = [];
  for (const [i, t] of b.times.entries()) {
    const seg = join(work, `seg_${String(i + 1).padStart(2, "0")}.mp4`);
    const clip = b.clips?.[i];
    await exec("ffmpeg", clip ? clipSegmentArgs(clip, t.end - t.start, seg) : segmentArgs(b.stills[i] ?? "", t.end - t.start, i, seg), { timeoutMs: 600_000 });
    segs.push(seg);
  }
  const segList = join(work, "segments.txt");
  writeFileSync(segList, segs.map((s) => `file '${s.replace(/'/g, "'\\''")}'`).join("\n") + "\n");
  const picture = join(work, "picture.mp4");
  await exec("ffmpeg", ["-hide_banner", "-nostdin", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", segList, "-c", "copy", picture], { timeoutMs: 120_000 });

  // 2. caption track + end card
  const blank = join(work, "blank.png");
  await exec("magick", ["-size", `${W}x${H}`, "xc:none", png32(blank)], { timeoutMs: 15_000 });
  const capFiles: { file: string; start: number; end: number }[] = [];
  for (const [i, c] of b.captions.entries()) {
    const file = join(work, `cap_${String(i + 1).padStart(3, "0")}.png`);
    await captionPng(c.text, file, b.look);
    capFiles.push({ file, start: c.start, end: c.end });
  }
  const capList = join(work, "captions.txt");
  writeFileSync(capList, captionTrackList(capFiles, blank, total));
  const card = join(work, "end_card.png");
  if (b.endCard) await endCardPng(b.endCard.text, card, b.look);
  else copyFileSync(blank, card);
  const cardOn = b.endCard ? `between(t,${b.endCard.start.toFixed(3)},${b.endCard.end.toFixed(3)})` : "0";

  // 3. picture + captions + card + narration (or silence) → -14 LUFS, H.264/AAC
  let narration: string | null = null;
  if (b.narration) {
    narration = join(work, "narration_norm.wav");
    await normalizeNarration(b.narration, narration);
  }
  const audioIn = narration ? ["-i", narration] : ["-f", "lavfi", "-t", total.toFixed(3), "-i", "anullsrc=r=48000:cl=stereo"];
  const audioFilter = b.narration ? "[3:a]aresample=48000,apad[a]" : "[3:a]anull[a]";
  await exec(
    "ffmpeg",
    [
      "-hide_banner", "-nostdin", "-loglevel", "error", "-y",
      "-i", picture,
      "-f", "concat", "-safe", "0", "-i", capList,
      "-loop", "1", "-i", card,
      ...audioIn,
      "-filter_complex", `[0:v][1:v]overlay=format=auto[v1];[v1][2:v]overlay=enable='${cardOn}':format=auto,format=yuv420p[v];${audioFilter}`,
      "-map", "[v]", "-map", "[a]", "-t", total.toFixed(3),
      "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-r", String(FPS),
      "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", b.out,
    ],
    { timeoutMs: 900_000 },
  );
  return { out: b.out, seconds: total };
}
