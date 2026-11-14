/**
 * Winner score (CLAUDE.md, DECISIONS "Cloning first, spy last"):
 * 0.6·norm(days_running) + 0.25·norm(variant_count) + 0.15·norm(est_reach).
 * Meta gives no reach for commercial ads, so the reach weight drops to 0 and the rest renormalize.
 * Normalized within one brand: days running is a strong signal for some brands and weak for others,
 * so no fixed day thresholds.
 */
const W_DAYS = 0.6;
const W_VARIANTS = 0.25;
const W_REACH = 0.15;

/** Inputs already normalized to 0..1; reach null when unknown. */
export function winnerScore(n: { days: number; variants: number; reach: number | null }): number {
  const known = n.reach !== null;
  const total = W_DAYS * n.days + W_VARIANTS * n.variants + (known ? W_REACH * (n.reach ?? 0) : 0);
  return round3(total / (W_DAYS + W_VARIANTS + (known ? W_REACH : 0)));
}

export interface Rankable {
  id: string;
  days: number;
  variants: number;
  reach?: number | null;
}

export interface Ranked extends Rankable {
  score: number;
  rank: number;
}

export function rankWithinBrand<T extends Rankable>(items: T[]): Array<T & { score: number; rank: number }> {
  const nd = normalizer(items.map((i) => i.days));
  const nv = normalizer(items.map((i) => i.variants));
  const reaches = items.map((i) => i.reach).filter((r): r is number => typeof r === "number");
  const allReach = reaches.length === items.length && items.length > 0;
  const nr = normalizer(reaches);
  return items
    .map((i) => ({ ...i, score: winnerScore({ days: nd(i.days), variants: nv(i.variants), reach: allReach ? nr(i.reach ?? 0) : null }) }))
    .sort((a, b) => b.score - a.score || b.days - a.days || a.id.localeCompare(b.id))
    .map((i, k) => ({ ...i, rank: k + 1 }));
}

/** Min-max to 0..1; with no spread every item gets full marks on that metric. */
function normalizer(values: number[]): (v: number) => number {
  const min = Math.min(...values);
  const max = Math.max(...values);
  return (v) => (max > min ? (v - min) / (max - min) : 1);
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
