import { words } from "./overlap.js";

/**
 * Default speaking rate (PRD press prompt: ~2.5 words/sec). The narrator's real rate comes from
 * renders/account.json (`narrator.words_per_second` per model; v4 casual talk measured 2.2 on
 * ep 7, 2026-11-07) and is passed in, so scripts are audited at the pace they will be read.
 */
export const WORDS_PER_SECOND = 2.5;
/** PRD acceptance: beat timing within ±10%. */
export const TIMING_TOLERANCE = 0.1;

export function spokenSeconds(text: string, wps = WORDS_PER_SECOND): number {
  return words(text).length / wps;
}

/** Word count that fills a window of `seconds` (rounded down), for prompts. */
export function wordBudget(seconds: number, wps = WORDS_PER_SECOND): { min: number; max: number } {
  return {
    min: Math.max(1, Math.ceil(seconds * wps * (1 - TIMING_TOLERANCE))),
    max: Math.max(1, Math.floor(seconds * wps * (1 + TIMING_TOLERANCE) + 1e-9)),
  };
}

export interface TimedLine {
  path: string;
  t: readonly [number, number] | readonly number[];
  line: string;
  /** On-screen text that may hold past its window (a caption hook in a captions-only format). */
  onScreen?: boolean;
}

export interface TimingResult {
  errors: string[];
  totalSeconds: number;
  withinPct: boolean;
}

/**
 * Each line must fit its window (+10%). The whole script must run within ±10% of the ad's
 * length, except captions-only formats (no voice), where only the upper bound applies.
 */
export function checkTiming(parts: TimedLine[], duration: number, captionsOnly: boolean, wps = WORDS_PER_SECOND): TimingResult {
  const errors: string[] = [];
  let total = 0;
  for (const p of parts) {
    const secs = spokenSeconds(p.line, wps);
    total += secs;
    const win = (p.t[1] ?? 0) - (p.t[0] ?? 0);
    if (!p.onScreen && secs > win * (1 + TIMING_TOLERANCE) + 1e-9) {
      errors.push(`${p.path}: ~${secs.toFixed(1)} s of speech in a ${win.toFixed(1)} s window (max ${wordBudget(win, wps).max} words)`);
    }
  }
  const lo = duration * (1 - TIMING_TOLERANCE);
  const hi = duration * (1 + TIMING_TOLERANCE);
  const withinPct = total <= hi + 1e-9 && (captionsOnly || total >= lo - 1e-9);
  if (!withinPct) {
    errors.push(`total ~${total.toFixed(1)} s of speech for the ${duration.toFixed(1)} s ad (target ${captionsOnly ? "up to" : `${lo.toFixed(1)}-`}${hi.toFixed(1)} s)`);
  }
  return { errors, totalSeconds: Math.round(total * 10) / 10, withinPct };
}
