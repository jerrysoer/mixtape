/**
 * Imperfection layer: natural disfluencies dropped into a narration monologue at a seeded
 * 10–20% rate (Jerry, 2026-11-07: "between 10 to 20% imperfection randomized", not an ad voice,
 * not sloppy). Works on clauses (sentence and comma boundaries). Never touches the first clause
 * (the hook) or the last (the landing), never two clauses in a row, at most one laugh.
 * Bracketed tags ([laughs], [exhales]) are ElevenLabs v4 delivery tags; captions strip them.
 */

export type ImperfectionKind = "filler" | "restart" | "trail" | "hedge" | "laugh" | "breath";

export const IMPERFECTION_KINDS: ImperfectionKind[] = ["filler", "restart", "trail", "hedge", "laugh", "breath"];
export const MAX_RATE = 0.3;

export interface ImperfectOptions {
  /** share of clauses touched, 0–0.3 */
  rate: number;
  seed: number;
  kinds?: ImperfectionKind[];
}

export interface ImperfectResult {
  text: string;
  changes: { clause: number; kind: ImperfectionKind }[];
}

/** Clauses with their punctuation attached; `join("")` gives the text back. */
export function splitClauses(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/[^.?!,]+(?:[.?!,]+["”]?|$)/g)) if (m[0].length) out.push(m[0]);
  return out;
}

/** mulberry32: small, seedable, good enough for picking clauses. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(xs: T[], r: () => number): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    const t = a[i] as T;
    a[i] = a[j] as T;
    a[j] = t;
  }
  return a;
}

/** Pick `count` clause indices from 1..n-2, none adjacent; random first, then even fill. */
function pickClauses(n: number, count: number, r: () => number): number[] {
  const eligible = Array.from({ length: Math.max(0, n - 2) }, (_, i) => i + 1);
  const picked: number[] = [];
  const ok = (i: number) => picked.every((p) => Math.abs(p - i) > 1);
  for (const i of shuffle(eligible, r)) {
    if (picked.length >= count) break;
    if (ok(i)) picked.push(i);
  }
  for (const i of eligible) {
    if (picked.length >= count) break;
    if (ok(i)) picked.push(i);
  }
  return picked.sort((a, b) => a - b);
}

const FILLERS = ["like, ", "I mean, ", "um, ", "honestly, "];
const HEDGES = [", kind of", ", I guess", ", sort of"];

function lead(clause: string): [string, string] {
  const m = /^\s*/.exec(clause);
  const sp = m ? m[0] : "";
  return [sp, clause.slice(sp.length)];
}

function lowerFirst(body: string): string {
  const w = /^[A-Za-z']+/.exec(body)?.[0] ?? "";
  if (w === "I" || w.startsWith("I'")) return body;
  return body.charAt(0).toLowerCase() + body.slice(1);
}

function apply(clause: string, kind: ImperfectionKind, r: () => number, sentenceStart: boolean, whole: string): string {
  const [sp, body] = lead(clause);
  switch (kind) {
    case "restart": {
      const w = /^[A-Za-z']+/.exec(body)?.[0];
      if (!w) return clause;
      const again = w === "I" || w.startsWith("I'") ? w : w.toLowerCase();
      return `${sp}${w}— ${again}${body.slice(w.length)}`;
    }
    case "filler": {
      const pool = FILLERS.filter((f) => !whole.toLowerCase().includes(f.trim().replace(",", "")));
      const f = pool[Math.floor(r() * pool.length)] ?? "um, ";
      const filler = sentenceStart ? f.charAt(0).toUpperCase() + f.slice(1) : f;
      return `${sp}${filler}${sentenceStart ? lowerFirst(body) : body}`;
    }
    case "trail":
      return `${sp}${body.replace(/[.?!,]+(["”]?)$/, "…$1")}`;
    case "hedge": {
      const h = HEDGES[Math.floor(r() * HEDGES.length)] ?? ", kind of";
      return `${sp}${body.replace(/([.?!,]+["”]?)$/, `${h}$1`)}`;
    }
    case "laugh":
      return `${sp}[laughs] ${body}`;
    case "breath":
      return `${sp}[exhales] ${body}`;
  }
}

/** Shared core: `clauses` is the whole monologue in order; returns the touched copy. */
function run(clauses: string[], opts: ImperfectOptions): ImperfectResult["changes"] {
  const rate = Math.min(MAX_RATE, Math.max(0, opts.rate));
  if (rate === 0 || clauses.length < 3) return [];
  const possible = Math.ceil((clauses.length - 2) / 2);
  const count = Math.min(possible, Math.max(1, Math.round(clauses.length * rate)));
  const r = rng(opts.seed);
  const picked = pickClauses(clauses.length, count, r);
  const kinds = shuffle(opts.kinds ?? IMPERFECTION_KINDS, r);
  const changes: ImperfectResult["changes"] = [];
  let laughed = false;
  picked.forEach((clause, i) => {
    let kind = kinds[i % kinds.length] as ImperfectionKind;
    if (kind === "laugh") {
      if (laughed && kinds.length > 1) kind = "filler";
      laughed = true;
    }
    const prev = clauses[clause - 1] ?? "";
    const sentenceStart = /[.?!]["”]?\s*$/.test(prev);
    clauses[clause] = apply(clauses[clause] as string, kind, r, sentenceStart, clauses.join(""));
    changes.push({ clause, kind });
  });
  return changes;
}

export function imperfect(text: string, opts: ImperfectOptions): ImperfectResult {
  const clauses = splitClauses(text);
  const changes = run(clauses, opts);
  return { text: changes.length ? clauses.join("") : text, changes };
}

/**
 * The same layer over a script's lines (hook first, then the beats) treated as ONE monologue, so
 * the first clause of the ad and its last line stay clean and the picks match `imperfect()` on
 * the joined text. Returns one line per input line.
 */
export function imperfectLines(lines: string[], opts: ImperfectOptions): { lines: string[]; changes: ImperfectResult["changes"] } {
  const per = lines.map((l) => splitClauses(l));
  const all = per.flat();
  const changes = run(all, opts);
  let i = 0;
  const out = per.map((cs) => cs.map(() => all[i++] as string).join(""));
  return { lines: out, changes };
}
