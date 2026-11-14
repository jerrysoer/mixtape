import type { Word } from "../../render/timeline.js";

export type LineWord = Omit<Word, "shot">;

const r3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * ElevenLabs `with-timestamps` gives per-character times. Words = runs of non-space characters;
 * [bracketed performance tags] (eleven_v3) are removed first so they never reach captions.
 */
export function charsToWords(chars: string[], starts: number[], ends: number[]): LineWord[] {
  const words: LineWord[] = [];
  let inTag = false;
  let cur = "";
  let s = 0;
  let e = 0;
  const flush = () => {
    if (cur) words.push({ w: cur, s: r3(s), e: r3(e) });
    cur = "";
  };
  chars.forEach((ch, i) => {
    if (ch === "[") {
      inTag = true;
      flush();
      return;
    }
    if (inTag) {
      if (ch === "]") inTag = false;
      return;
    }
    if (/\s/.test(ch)) {
      flush();
      return;
    }
    if (!cur) s = starts[i] ?? 0;
    cur += ch;
    e = ends[i] ?? s;
  });
  flush();
  return words;
}

export function offsetWords(words: LineWord[], offset: number, shot: number): Word[] {
  return words.map((w) => ({ w: w.w, s: r3(w.s + offset), e: r3(w.e + offset), shot }));
}

const norm = (s: string) => (s.toLowerCase().replace(/(\d)-(\d)|(\w)-(\w)/g, "$1$3 $2$4").match(/[a-z0-9']+/g) ?? []);

/**
 * Why a take doesn't match its line, or "" (from /2minvid record.py, 2026-10-22): v3/v4 sometimes
 * repeat a phrase and forced alignment hides it. Compare a whisper transcript of the take alone:
 * a repeated 3-gram the line lacks, 3+ extra words, or 3+ missing words (lines of 8+ words) = wrong.
 */
export function heardWrong(heardText: string, wantText: string): string {
  const heard = norm(heardText);
  const want = norm(wantText);
  if (!heard.length) return "";
  const grams = (ws: string[]) => ws.slice(0, -2).map((_, i) => ws.slice(i, i + 3).join(" "));
  const hg = grams(heard);
  const wg = grams(want);
  const count = (xs: string[], x: string) => xs.filter((y) => y === x).length;
  const rep = [...new Set(hg)].find((g) => count(hg, g) > 1 && count(hg, g) > count(wg, g));
  if (rep) return `repeats "${rep}"`;
  if (heard.length >= want.length + 3) return `${heard.length - want.length} extra words heard`;
  if (want.length >= 8 && heard.length <= want.length - 3) return `${want.length - heard.length} words not heard`;
  return "";
}
