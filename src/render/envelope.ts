import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MixtapeError } from "../lib/io.js";
import type { Quote } from "./quote.js";

/**
 * A spend envelope for one render (sprint 13): the user grants "up to N Dreamina credits and $M of
 * narration" once, and `--run` approves each later quote of that render by itself while it fits in
 * what is left. Every approval still goes through `approveQuote` (ceiling, exact id) and writes
 * `approval.json`, so the ledger and the audit trail are the same as a hand approval. The envelope
 * never covers a batch pack and never carries to another render folder.
 */
export interface Envelope {
  /** Dreamina credits granted (stills + clips). */
  maxCredits: number;
  /** Narration dollars granted (ElevenLabs, billed outside credits). */
  maxUsd: number;
  grantedAt: string;
  /** Quotes approved under this envelope; each reserves its full quoted amount. */
  approved: { quoteId: string; credits: number; usd: number; at: string }[];
}

export const ENVELOPE_FILE = "envelope.json";

/**
 * "1000cr $1.50", "1000 cr, $1.50", "1000:1.5", "1000/1.5". Credits are whole; dollars may be 0
 * ("1000cr $0") for a captions-only ad. Both numbers are required so a grant is never guessed.
 */
export function parseEnvelope(text: string): { credits: number; usd: number } {
  const t = text.trim().toLowerCase();
  const cr = /(\d+(?:\.\d+)?)\s*cr(?:edits?)?\b/.exec(t);
  const usd = /\$\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*(?:usd|dollars?)\b/.exec(t);
  let credits: number | undefined = cr ? Number(cr[1]) : undefined;
  let dollars: number | undefined = usd ? Number(usd[1] ?? usd[2]) : undefined;
  if (credits === undefined && dollars === undefined) {
    const parts = t.split(/[\s:/,]+/).filter(Boolean);
    if (parts.length === 2 && parts.every((p) => /^\d+(\.\d+)?$/.test(p))) {
      credits = Number(parts[0]);
      dollars = Number(parts[1]);
    }
  }
  if (credits === undefined || dollars === undefined || !Number.isFinite(credits) || !Number.isFinite(dollars)) {
    throw new MixtapeError('--approve-envelope needs Dreamina credits AND narration dollars, e.g. --approve-envelope "1000cr $1.50" (or 1000:1.50).');
  }
  if (!Number.isInteger(credits) || credits < 0 || credits > 100_000) throw new MixtapeError("--approve-envelope: credits must be a whole number, 0-100000.");
  if (dollars < 0 || dollars > 100) throw new MixtapeError("--approve-envelope: narration dollars must be 0-100.");
  return { credits, usd: Math.round(dollars * 100) / 100 };
}

export function readEnvelope(dir: string): Envelope | null {
  const file = join(dir, ENVELOPE_FILE);
  if (!existsSync(file)) return null;
  try {
    const e = JSON.parse(readFileSync(file, "utf8")) as Envelope;
    if (typeof e.maxCredits !== "number" || typeof e.maxUsd !== "number" || !Array.isArray(e.approved)) return null;
    return e;
  } catch {
    return null;
  }
}

/** Grant (or replace) the envelope for a render folder. A new grant starts a fresh tally. */
export function grantEnvelope(dir: string, grant: { credits: number; usd: number }): Envelope {
  const e: Envelope = { maxCredits: grant.credits, maxUsd: grant.usd, grantedAt: new Date().toISOString(), approved: [] };
  writeFileSync(join(dir, ENVELOPE_FILE), JSON.stringify(e, null, 2) + "\n");
  return e;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export function envelopeLeft(e: Envelope): { credits: number; usd: number } {
  const used = e.approved.reduce((a, q) => ({ credits: a.credits + q.credits, usd: a.usd + q.usd }), { credits: 0, usd: 0 });
  return { credits: e.maxCredits - used.credits, usd: r2(e.maxUsd - used.usd) };
}

export type Draw = { ok: true; left: { credits: number; usd: number } } | { ok: false; why: string };

/**
 * Approve a quote out of the envelope if its credits and its narration dollars both fit in what is
 * left (the credits' dollar value is covered by the credits themselves). Reserves the full quote.
 * A quote already drawn is not drawn twice (a rerun of the same quote id is a resume).
 */
export function drawEnvelope(dir: string, q: Pick<Quote, "id" | "credits" | "voiceUsd">): Draw {
  const e = readEnvelope(dir);
  if (!e) return { ok: false, why: "no envelope for this render" };
  const prior = e.approved.find((a) => a.quoteId === q.id);
  if (prior) return { ok: true, left: envelopeLeft(e) };
  const left = envelopeLeft(e);
  if (q.credits > left.credits || q.voiceUsd > left.usd + 1e-6) {
    return { ok: false, why: `the quote (${q.credits} cr, $${q.voiceUsd.toFixed(2)} narration) is more than the envelope has left (${left.credits} cr, $${left.usd.toFixed(2)})` };
  }
  e.approved.push({ quoteId: q.id, credits: q.credits, usd: r2(q.voiceUsd), at: new Date().toISOString() });
  writeFileSync(join(dir, ENVELOPE_FILE), JSON.stringify(e, null, 2) + "\n");
  return { ok: true, left: envelopeLeft(e) };
}
