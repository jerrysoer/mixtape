import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { isCloseUp, type ClipJob, type Plan, type PlanShot, type StillJob } from "./plan.js";
import type { ShotTime } from "./timeline.js";

/**
 * Motion stage (default render mode): one Seedance clip per shot, started from that shot's
 * QC-locked still (m2v, first frame), long enough to cover the shot's window in the cut.
 * Patterns from showrun/2minvid (read only): tight windows, exposure held to the first frame,
 * mouths closed unless someone speaks, one speaker per clip, no negative prompts.
 */

export const MIN_CLIP_S = 4;
export const MAX_CLIP_S = 30;
/**
 * A clip on file may run this share shorter than its window and still be reused: the cut slows it
 * (down to 0.9x, the line-lock floor) and holds the last frame for the rest, instead of buying a new
 * clip at 18 cr/s (ep 7 D re-bought a 6 s clip for a 7 s window, 2026-11-07).
 */
export const CLIP_SHORT_TOLERANCE = 0.1;

/** Is a clip of `have` seconds enough for a window that now needs `need` seconds? */
export function enoughClip(have: number, need: number): boolean {
  return have >= need * (1 - CLIP_SHORT_TOLERANCE) - 1e-9;
}

const NO_TEXT = "No text, logos or watermarks appear. No real people, celebrities, brands or existing characters.";
/** Seedance returns clips ~0.3 brighter and drifts the look unless told to hold the first frame (2minvid lessons). */
/** Rule 0 step 3 (showrun lip-sync.md), verbatim; the provider swaps {{audio}} for the uploaded ref. */
export const LIPS_LINE = "Lips follow {{audio}} exactly: same timing, same pace, the same pauses; the words begin at once on the first frame; no added pauses, never slower or faster; mouth closed in silences and closed for the rest of the clip once the words end.";
const HOLD_FRAME = "Start exactly on the first frame and keep its person, framing, exposure, colour and light for the whole clip: no brightening, no new objects, no cuts, no camera switch.";

function sentence(s: string): string {
  const t = s.trim().replace(/[.\s]+$/, "");
  return t ? `${t.charAt(0).toUpperCase()}${t.slice(1)}.` : "";
}

/** Clip length for a shot window: whole seconds, the window rounded up (a hair of slack), 4-30 s. */
export function clipSeconds(windowS: number): number {
  return Math.min(MAX_CLIP_S, Math.max(MIN_CLIP_S, Math.ceil(windowS - 0.1)));
}

export function clipHash(c: Pick<ClipJob, "prompt" | "seconds" | "model" | "speaker">, stillHash: string, audioHash = ""): string {
  return createHash("sha1").update(JSON.stringify([stillHash, c.prompt, c.seconds, c.model, c.speaker, audioHash])).digest("hex").slice(0, 16);
}

/** clipHash without the length: what the clip shows, not how long it runs. */
export function clipBase(c: Pick<ClipJob, "prompt" | "model" | "speaker">, stillHash: string, audioHash = ""): string {
  return createHash("sha1").update(JSON.stringify([stillHash, c.prompt, c.model, c.speaker, audioHash])).digest("hex").slice(0, 16);
}

/** Camera-derived motion when the script gives none: close-ups creep in, wider shots drift like a handheld phone. */
export function defaultMotion(camera: string): string {
  return isCloseUp(camera) ? "very slow push in, small natural movement, nothing enters the frame" : "slight handheld drift and a slow push in, natural small movements";
}

export function clipPrompt(style: string, shot: PlanShot, withAudio = false): string {
  const people = Object.entries(shot.people).map(([name, action]) => sentence(`${name}: ${action}`));
  const speech = shot.speaker
    ? `${shot.speaker} speaks to camera; no one else speaks. ${withAudio ? LIPS_LINE : "Mouth moving naturally with the words, closed in silences."}`
    : "Nobody speaks; every mouth stays closed.";
  return [sentence(style), sentence(shot.prompt), sentence(`Motion: ${shot.motion ?? defaultMotion(shot.camera)}`), ...people, speech, HOLD_FRAME, NO_TEXT].filter(Boolean).join(" ");
}

export interface ClipPlanOptions {
  model: string;
  /** Cheaper model for shots with no speaker (unset = `model`). */
  silentModel?: string | undefined;
  /** Shots that already used their one clip retake and failed again: they stay stills (0 cr). */
  stillOnly?: Set<string> | undefined;
  /** The tight audio ref for a speaking shot (sync.ts tightRef), by shot number; absent = no lips. */
  audioFor?: ((shot: number) => string | undefined) | undefined;
}

/** Build the clip jobs for a plan whose shot stills are all QC-locked. `times` is the cut timing (narration or t_target). */
export function buildClipPlan(plan: Pick<Plan, "style" | "shots" | "stills">, times: ShotTime[], o: ClipPlanOptions): ClipJob[] {
  const stillsById = new Map(plan.stills.map((j) => [j.id, j] as [string, StillJob]));
  const jobs: ClipJob[] = [];
  for (const [i, shot] of plan.shots.entries()) {
    const still = `shot_${String(shot.n).padStart(2, "0")}`;
    const id = `clip_${String(shot.n).padStart(2, "0")}`;
    if (o.stillOnly?.has(id)) continue;
    const t = times[i];
    const window = t ? t.end - t.start : shot.t_target[1] - shot.t_target[0];
    const speaker = shot.speaker ?? null;
    const audio = speaker ? o.audioFor?.(shot.n) : undefined;
    const base = { prompt: clipPrompt(plan.style, shot, Boolean(audio)), seconds: clipSeconds(window), model: speaker || !o.silentModel ? o.model : o.silentModel, speaker };
    const audioHash = audio ? createHash("sha1").update(readFileSync(audio)).digest("hex").slice(0, 16) : "";
    const stillHash = stillsById.get(still)?.hash ?? "";
    jobs.push({ id, still, shot: shot.n, ...base, ...(audio ? { audio } : {}), hash: clipHash(base, stillHash, audioHash), base: clipBase(base, stillHash, audioHash) });
  }
  return jobs;
}
