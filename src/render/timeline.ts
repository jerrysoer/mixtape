import { MixtapeError } from "../lib/io.js";

/**
 * Cut timing. The recorded narration drives the picture (memory: "audio is the master"):
 * each shot cuts in on the first word of its line; t_target is checked, not forced.
 * Captions-only formats (no voice) use the structure's windows.
 */

/** One narrated word: text, start, end (seconds in the narration file), and its shot number. */
export interface Word {
  w: string;
  s: number;
  e: number;
  shot: number;
}

export interface ShotTime {
  n: number;
  start: number;
  end: number;
}

export interface Caption {
  text: string;
  start: number;
  end: number;
}

/** Hold after the last word before the cut ends. */
export const TAIL_S = 0.6;
/** Extra hold on the end card so the offer can be read. */
export const CTA_HOLD_S = 1.2;
/** A caption may linger this long after its last word when nothing follows soon. */
const LINGER_S = 0.4;
const MAX_HOLD_S = 0.8;

const r3 = (n: number) => Math.round(n * 1000) / 1000;

export function shotTimes(p: { shots: { n: number; t_target: readonly number[] }[]; endCard: boolean }, words: Word[] | null): ShotTime[] {
  if (!words) {
    return p.shots.map((s) => ({ n: s.n, start: s.t_target[0] ?? 0, end: s.t_target[1] ?? 0 }));
  }
  const firstWord = p.shots.map((s) => {
    const mine = words.filter((x) => x.shot === s.n);
    const first = mine[0];
    if (!first) throw new MixtapeError(`shot ${s.n} has no narrated words; re-record the narration.`);
    return first.s;
  });
  const lastWordEnd = Math.max(...words.map((x) => x.e));
  return p.shots.map((s, i) => {
    const start = i === 0 ? 0 : (firstWord[i] ?? 0);
    const next = firstWord[i + 1];
    const end = next !== undefined ? next : lastWordEnd + TAIL_S + (p.endCard ? CTA_HOLD_S : 0);
    return { n: s.n, start: r3(start), end: r3(end) };
  });
}

/**
 * Word-by-word captions: up to `maxWords` per chunk, uppercased; a chunk ends at a sentence end,
 * at a comma once it has 2+ words, or at a shot change. Each chunk shows until the next one starts,
 * but never more than 0.8 s past its last word (0.4 s for the very last chunk).
 */
export function captionChunks(words: Word[], maxWords = 3): Caption[] {
  const groups: Word[][] = [];
  let cur: Word[] = [];
  const flush = () => {
    if (cur.length) groups.push(cur);
    cur = [];
  };
  for (const word of words) {
    if (cur.length && (cur[0]?.shot !== word.shot || cur.length >= maxWords)) flush();
    cur.push(word);
    if (/[.!?]["')\]]?$/.test(word.w) || (/[,;:]$/.test(word.w) && cur.length >= 2)) flush();
  }
  flush();

  return groups.map((g, i) => {
    const start = g[0]?.s ?? 0;
    const lastEnd = g.at(-1)?.e ?? start;
    const nextStart = groups[i + 1]?.[0]?.s;
    const end = nextStart === undefined ? lastEnd + LINGER_S : Math.min(nextStart, lastEnd + MAX_HOLD_S);
    return { text: g.map((x) => x.w).join(" ").toUpperCase(), start: r3(start), end: r3(end) };
  });
}

/** Captions-only formats: each shot's whole line, on screen for the shot. */
export function lineCaptions(shots: { n: number; vo: string; t: { start: number; end: number } }[]): Caption[] {
  return shots.filter((s) => s.vo.trim()).map((s) => ({ text: s.vo.trim(), start: s.t.start, end: s.t.end }));
}
