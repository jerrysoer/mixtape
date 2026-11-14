import { join } from "node:path";
import { exec } from "./exec.js";
import type { Scene } from "./scenes.js";

/** Claude Code reads these images, so keep the set small and the frames light. */
export const MAX_FRAMES = 16;
export const FRAME_WIDTH = 540;

/**
 * Pick frame times: always one in the hook (0.5 s) and one near the end (end card),
 * then each scene's midpoint. If there are too many scenes, keep an even spread.
 */
export function pickFrameTimes(scenes: Scene[], duration: number, max: number = MAX_FRAMES): number[] {
  const round = (t: number) => Math.round(t * 100) / 100;
  const mids = scenes.map((s) => round((s.t[0] + s.t[1]) / 2));
  const fixed = [round(Math.min(0.5, duration / 4)), round(Math.max(0, duration - 0.5))];
  let pool = [...new Set([...fixed, ...mids])].sort((a, b) => a - b);
  if (pool.length > max) {
    const step = (pool.length - 1) / (max - 1);
    pool = Array.from({ length: max }, (_, i) => pool[Math.round(i * step)] ?? 0);
  }
  return [...new Set(pool)];
}

export interface Frame {
  t: number;
  file: string;
}

export const SHEET_COLS = 4;

/**
 * One tiled image of all frames (left to right, top to bottom, in time order), so Claude Code
 * reads one image instead of up to 16. Unlabeled: the ffmpeg build may lack drawtext.
 */
export async function contactSheet(framesDir: string, count: number, outFile: string): Promise<string | null> {
  if (count === 0) return null;
  const rows = Math.ceil(count / SHEET_COLS);
  await exec(
    "ffmpeg",
    ["-hide_banner", "-nostdin", "-loglevel", "error", "-y", "-pattern_type", "glob", "-i", join(framesDir, "f*.jpg"), "-vf", `scale=270:-2,tile=${SHEET_COLS}x${rows}:padding=6:color=gray`, "-frames:v", "1", "-q:v", "3", outFile],
    { timeoutMs: 30_000 },
  );
  return outFile;
}

export async function extractFrames(absPath: string, times: number[], outDir: string): Promise<Frame[]> {
  const frames: Frame[] = [];
  for (const [i, t] of times.entries()) {
    const file = join(outDir, `f${String(i + 1).padStart(2, "0")}_${t.toFixed(2)}s.jpg`);
    // -ss before -i = fast seek; one frame, scaled, JPEG quality 4.
    await exec("ffmpeg", ["-hide_banner", "-nostdin", "-loglevel", "error", "-y", "-ss", String(t), "-i", absPath, "-frames:v", "1", "-vf", `scale=${FRAME_WIDTH}:-2`, "-q:v", "4", file], {
      timeoutMs: 30_000,
    });
    frames.push({ t, file });
  }
  return frames;
}
