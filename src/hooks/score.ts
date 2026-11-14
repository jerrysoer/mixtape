import { z } from "zod";
import { longestSharedRun, mentionsName, nearCopy, words } from "../guard/overlap.js";
import { formatIssues } from "../schema/structure.js";
import { HOOK_MAX_WORDS } from "./limits.js";

/**
 * Hook scoring (PRD §4 "Proven prompts"): final = 0.45·scroll + 0.35·curiosity + 0.2·fit, keep the top 5.
 * Claude Code writes and scores the 10 hooks (skill mode); this module validates and ranks them.
 */
export const HOOK_WEIGHTS = { scroll: 0.45, curiosity: 0.35, fit: 0.2 } as const;
export const HOOK_COUNT = 10;
export const HOOK_KEEP = 5;
export { HOOK_MAX_WORDS };
/** A harsh judge spreads scores: each dimension must use at least this many distinct values across the 10. */
export const MIN_DISTINCT_SCORES = 3;
/** Hooks are the most copyable line in an ad, so they get the strict (break-level) overlap limit. */
export const HOOK_MAX_SHARED_RUN = 5;

const score = z.number().int().min(1).max(10);

export const hookAnswerSchema = z
  .object({
    hooks: z
      .array(z.object({ text: z.string().trim().min(3).max(120), scroll: score, curiosity: score, fit: score }).strict())
      .length(HOOK_COUNT, `exactly ${HOOK_COUNT} hooks`),
  })
  .strict();

export interface ScoredHook {
  text: string;
  scroll: number;
  curiosity: number;
  fit: number;
  score: number;
}

export function hookScore(h: { scroll: number; curiosity: number; fit: number }): number {
  const raw = HOOK_WEIGHTS.scroll * h.scroll + HOOK_WEIGHTS.curiosity * h.curiosity + HOOK_WEIGHTS.fit * h.fit;
  return Math.round(raw * 100) / 100;
}

export interface HookCheckContext {
  /** Source transcript + ad copy, when the structure came from a real ad. */
  sourceText: string;
  /** Source brand (page name); hooks may not mention it. */
  brand: string;
  /** Tighter word limit for a spoken hook window (see hookWordLimit). Default HOOK_MAX_WORDS. */
  maxWords?: number;
}

export interface HookCheckResult {
  errors: string[];
  /** All hooks, best first (stable for ties). Empty when there are errors. */
  ranked: ScoredHook[];
  top: ScoredHook[];
}

export function checkHooks(answer: unknown, ctx: HookCheckContext): HookCheckResult {
  const parsed = hookAnswerSchema.safeParse(answer);
  if (!parsed.success) return { errors: formatIssues(parsed.error), ranked: [], top: [] };
  const hooks = parsed.data.hooks;
  const errors: string[] = [];

  const limit = Math.min(HOOK_MAX_WORDS, ctx.maxWords ?? HOOK_MAX_WORDS);
  const seen = new Map<string, number>();
  hooks.forEach((h, i) => {
    const w = words(h.text);
    if (w.length > limit) errors.push(`hooks.${i}: ${w.length} words (max ${limit})`);
    const key = w.join(" ");
    const first = seen.get(key);
    if (first !== undefined) errors.push(`hooks.${i}: duplicates hooks.${first}`);
    else seen.set(key, i);
    if (mentionsName(h.text, ctx.brand)) errors.push(`hooks.${i}: names the source brand`);
    const run = ctx.sourceText ? longestSharedRun(h.text, ctx.sourceText, HOOK_MAX_SHARED_RUN) : null;
    if (run) errors.push(`hooks.${i}: shares ${run.length} words in a row with the source ad ("${run.run}")`);
    const near = !run && ctx.sourceText ? nearCopy(h.text, ctx.sourceText) : null;
    if (near) errors.push(`hooks.${i}: near-copy of a source line (${Math.round(near.ratio * 100)}% of its words in order); rewrite it`);
  });

  for (const dim of ["scroll", "curiosity", "fit"] as const) {
    const distinct = new Set(hooks.map((h) => h[dim])).size;
    if (distinct < MIN_DISTINCT_SCORES) errors.push(`${dim}: only ${distinct} distinct scores across ${HOOK_COUNT} hooks; be a harsher judge and spread them`);
  }
  if (errors.length) return { errors, ranked: [], top: [] };

  const ranked = hooks
    .map((h, i) => ({ h: { ...h, score: hookScore(h) }, i }))
    .sort((a, b) => b.h.score - a.h.score || a.i - b.i)
    .map((x) => x.h);
  return { errors: [], ranked, top: ranked.slice(0, HOOK_KEEP) };
}
