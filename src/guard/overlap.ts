/**
 * Shared-word-run detection between our text and a source transcript.
 * Used by `break` (no source line may appear in structure.json) and, from sprint 3,
 * by the originality guard on script.json.
 */

/** Lowercase, fold curly quotes, keep letters/digits/apostrophes, split on everything else. */
export function words(text: string): string[] {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[‘’ʼ]/g, "'")
    .split(/[^\p{L}\p{N}']+/u)
    .map((w) => w.replace(/^'+|'+$/g, ""))
    .filter(Boolean);
}

export interface SharedRun {
  /** The shared words, normalized. */
  run: string;
  length: number;
}

/**
 * Longest run of consecutive words that `candidate` shares with `source`,
 * or null when no run reaches `minLength` words.
 */
export function longestSharedRun(candidate: string, source: string, minLength: number): SharedRun | null {
  const a = words(candidate);
  const b = words(source);
  if (a.length < minLength || b.length < minLength) return null;
  // Index every minLength-gram of the source, then extend each seed match as far as it goes.
  const seeds = new Map<string, number[]>();
  for (let j = 0; j + minLength <= b.length; j++) {
    const key = b.slice(j, j + minLength).join(" ");
    const list = seeds.get(key);
    if (list) list.push(j);
    else seeds.set(key, [j]);
  }
  let best: SharedRun | null = null;
  for (let i = 0; i + minLength <= a.length; i++) {
    const hits = seeds.get(a.slice(i, i + minLength).join(" "));
    if (!hits) continue;
    for (const j of hits) {
      let n = minLength;
      while (i + n < a.length && j + n < b.length && a[i + n] === b[j + n]) n++;
      if (!best || n > best.length) best = { run: a.slice(i, i + n).join(" "), length: n };
    }
  }
  return best;
}

export const NEAR_COPY_MIN_WORDS = 6;
export const NEAR_COPY_RATIO = 0.75;

function lcsLength(a: string[], b: string[]): number {
  let prev = new Array<number>(b.length + 1).fill(0);
  for (const x of a) {
    const cur = new Array<number>(b.length + 1).fill(0);
    for (let j = 0; j < b.length; j++) cur[j + 1] = x === b[j] ? (prev[j] ?? 0) + 1 : Math.max(prev[j + 1] ?? 0, cur[j] ?? 0);
    prev = cur;
  }
  return prev[b.length] ?? 0;
}

/**
 * Near-copy check: a line that keeps most of a source line's words in order with a few swapped
 * ("Sarah's order" → "Tammy's order") slips past run-length checks. Flags when at least `ratio`
 * of the candidate's words appear in order inside one source window of 2× the candidate's length.
 */
export function nearCopy(candidate: string, source: string, minWords: number = NEAR_COPY_MIN_WORDS, ratio: number = NEAR_COPY_RATIO): { ratio: number; length: number } | null {
  const a = words(candidate);
  const b = words(source);
  if (a.length < minWords || b.length === 0) return null;
  const vocab = new Set(a);
  const span = a.length * 2;
  let best = 0;
  for (let j = 0; j < b.length; j++) {
    if (!vocab.has(b[j] ?? "")) continue; // windows start on a shared word
    best = Math.max(best, lcsLength(a, b.slice(j, j + span)));
    if (best === a.length) break;
  }
  const r = best / a.length;
  return r >= ratio ? { ratio: Math.round(r * 1000) / 1000, length: best } : null;
}

/** True when `text` mentions `name` as a whole word or phrase (case-insensitive). Names under 3 chars are ignored. */
export function mentionsName(text: string, name: string): boolean {
  const n = name.trim();
  if (n.length < 3) return false;
  const escaped = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, "iu").test(text);
}

/** Quoted spans of `minWords`+ words ("…", “…”, '…' with spaces inside). A structure describes; it never quotes. */
export function quotedSpans(text: string, minWords: number): string[] {
  const found: string[] = [];
  const re = /["“”]([^"“”]+)["“”]|(?:^|\s)'([^']+)'(?=\s|$|[.,!?;:])/g;
  for (const m of text.matchAll(re)) {
    const inner = (m[1] ?? m[2] ?? "").trim();
    if (words(inner).length >= minWords) found.push(inner);
  }
  return found;
}
