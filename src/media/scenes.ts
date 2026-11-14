import { exec } from "./exec.js";

/** ffmpeg scene-change threshold (0-1). 0.3 catches hard cuts without firing on camera moves. */
export const SCENE_THRESHOLD = 0.3;
/** Cuts closer than this to the previous one are merged (flash frames, whip pans). */
export const MIN_SCENE_S = 0.4;

/** Pull `pts_time:<t>` values out of ffmpeg showinfo stderr. */
export function parseShowinfo(stderr: string): number[] {
  const times: number[] = [];
  for (const m of stderr.matchAll(/pts_time:\s*([0-9.]+)/g)) {
    const t = Number(m[1]);
    if (Number.isFinite(t)) times.push(t);
  }
  return times;
}

/** Sorted cut times strictly inside (0, duration), with near-duplicates merged. */
export function cleanCuts(times: number[], duration: number, minGap: number = MIN_SCENE_S): number[] {
  const out: number[] = [];
  for (const t of [...times].sort((a, b) => a - b)) {
    if (t < minGap || t > duration - minGap) continue;
    const last = out.at(-1) ?? 0;
    if (t - last >= minGap) out.push(Math.round(t * 100) / 100);
  }
  return out;
}

export interface Scene {
  t: [number, number];
}

export function scenesFromCuts(cuts: number[], duration: number): Scene[] {
  const edges = [0, ...cuts, duration];
  return edges.slice(0, -1).map((start, i) => ({ t: [start, edges[i + 1] ?? duration] }));
}

export async function detectScenes(absPath: string, duration: number): Promise<Scene[]> {
  // showinfo logs one line per selected (scene-change) frame on stderr.
  const { stderr } = await exec(
    "ffmpeg",
    ["-hide_banner", "-nostdin", "-i", absPath, "-an", "-vf", `select='gt(scene,${SCENE_THRESHOLD})',showinfo`, "-f", "null", "-"],
    { timeoutMs: 180_000 },
  );
  return scenesFromCuts(cleanCuts(parseShowinfo(stderr), duration), duration);
}
