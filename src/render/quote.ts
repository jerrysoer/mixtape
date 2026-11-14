import { createHash } from "node:crypto";
import { MixtapeError } from "../lib/io.js";
import type { Plan } from "./plan.js";

/**
 * The spend gate (DECISIONS "Plan answers"): one quote per clone covering stills + voice, a
 * per-run ceiling, and nothing paid without `--approve <quote-id>`. Quote ids hash the exact
 * prompts, references, narration and rates, so any change to the plan needs a new approval.
 */

export interface Rates {
  creditsPerStill: number;
  /** Seedance clip estimate per second of clip (motion stage). */
  creditsPerVideoSec: number;
  creditsPerUsd: number;
  voiceUsdPer1kChars: number;
  ceilingUsd: number;
}

export interface QuoteItem {
  label: string;
  units: number;
  unitName: string;
  credits: number;
  usd: number;
}

export interface Quote {
  id: string;
  slug: string;
  /** True until a provider returns a server price (sprint 5 checks it against this). */
  estimate: true;
  items: QuoteItem[];
  credits: number;
  stillsUsd: number;
  voiceUsd: number;
  usd: number;
  ceilingUsd: number;
  overCeiling: boolean;
  rates: Rates;
}

const round = (n: number, places = 4) => Math.round(n * 10 ** places) / 10 ** places;

export interface QuoteOptions {
  /** Still ids already generated and reusable (QC-passed, or same prompt): 0 cr ("on file"). */
  onFile?: Set<string>;
  /** Narration characters already recorded and cached: not billed again. */
  voiceCachedChars?: number;
}

export function quoteId(plan: Plan, rates: Rates, o: QuoteOptions = {}): string {
  const basis = JSON.stringify({
    stills: plan.stills.map((j) => [j.id, j.prompt, j.refs]),
    // Stills-stage ids are unchanged from before motion existed (old approvals stay valid).
    ...(plan.stage !== "stills" ? { stage: plan.stage, clips: plan.clips.map((c) => [c.id, c.hash]) } : {}),
    voice: plan.voice.text,
    aspect: plan.aspect,
    rates,
    onFile: [...(o.onFile ?? [])].sort(),
    voiceCached: o.voiceCachedChars ?? 0,
  });
  return `q-${createHash("sha256").update(basis).digest("hex").slice(0, 10)}`;
}

export function buildQuote(plan: Plan, rates: Rates, o: QuoteOptions = {}): Quote {
  const onFile = o.onFile ?? new Set<string>();
  // The voice stage records the narration first (before any still is bought): nothing else is in it.
  const stills = plan.stage === "voice" ? [] : plan.stills;
  const count = (k: "sheet" | "plate" | "shot") => stills.filter((j) => j.kind === k && !onFile.has(j.id)).length;
  const still = (label: string, n: number): QuoteItem => ({ label, units: n, unitName: "still", credits: n * rates.creditsPerStill, usd: round((n * rates.creditsPerStill) / rates.creditsPerUsd) });
  const items: QuoteItem[] = [still("character sheets", count("sheet")), still("set plates", count("plate")), still("shot stills", count("shot"))].filter((i) => i.units > 0);
  const reused = stills.filter((j) => onFile.has(j.id)).length;
  if (reused) items.push({ label: "on file", units: reused, unitName: "still", credits: 0, usd: 0 });
  // "on file" includes jobs already paid for and still rendering (see Dreamina.paid).
  if (plan.stage === "clips") {
    const todo = plan.clips.filter((c) => !onFile.has(c.id));
    const secs = todo.reduce((a, c) => a + c.seconds, 0);
    if (todo.length) items.push({ label: `clips (${todo.length})`, units: secs, unitName: "clip second", credits: secs * rates.creditsPerVideoSec, usd: round((secs * rates.creditsPerVideoSec) / rates.creditsPerUsd) });
    const kept = plan.clips.length - todo.length;
    if (kept) items.push({ label: "clips on file", units: kept, unitName: "clip", credits: 0, usd: 0 });
  }
  const billedChars = Math.max(0, plan.voice.chars - (o.voiceCachedChars ?? 0));
  const voiceUsd = round((billedChars / 1000) * rates.voiceUsdPer1kChars, 6);
  if (plan.voice.mode === "narrator" && billedChars > 0) items.push({ label: "narration", units: billedChars, unitName: "chars", credits: 0, usd: voiceUsd });
  const credits = items.reduce((a, i) => a + i.credits, 0);
  const stillsUsd = round(credits / rates.creditsPerUsd, 6);
  const usd = round(stillsUsd + voiceUsd, 6);
  return {
    id: quoteId(plan, rates, o),
    slug: plan.slug,
    estimate: true,
    items,
    credits,
    stillsUsd,
    voiceUsd,
    usd,
    ceilingUsd: rates.ceilingUsd,
    overCeiling: usd > rates.ceilingUsd,
    rates,
  };
}

declare const approvalBrand: unique symbol;
/** Only approveQuote() makes one; providers take it as proof that Jerry approved this exact quote. */
export type ApprovalToken = { readonly quoteId: string; readonly maxUsd: number; readonly maxCredits: number } & { readonly [approvalBrand]: true };

export function approveQuote(q: Quote, givenId: string): ApprovalToken {
  if (givenId.trim() !== q.id) throw new MixtapeError(`--approve ${givenId} does not match the current quote ${q.id}. The plan changed or the id is wrong; re-read the quote.`);
  if (q.overCeiling) throw new MixtapeError(`Quote ${q.id} is $${q.usd.toFixed(2)}, over the $${q.ceilingUsd.toFixed(2)} ceiling (MX_MAX_SPEND_PER_RUN). Raise the ceiling or cut stills.`);
  return { quoteId: q.id, maxUsd: q.usd, maxCredits: q.credits } as ApprovalToken;
}
