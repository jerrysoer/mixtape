import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { MixtapeError } from "../lib/io.js";
import type { ApprovalToken } from "./quote.js";

/**
 * The spend ledger for one approved render. Every paid call asks `reserve()` first; nothing runs
 * past the approved credits or dollars, retakes included. Saved after every change (spend.json),
 * so a crash or rerun never forgets money already spent.
 */
export interface Ledger {
  quoteId: string;
  maxCredits: number;
  maxUsd: number;
  spentCredits: number;
  spentUsd: number;
  /** usd = total for the entry (rounded, for reading); other = its non-credit dollars, exact. */
  entries: { at: string; what: string; credits: number; usd: number; other?: number }[];
}

export class Budget {
  private constructor(
    private readonly file: string,
    private readonly ledger: Ledger,
    private readonly creditsPerUsd: number,
  ) {}

  static open(file: string, token: ApprovalToken, creditsPerUsd: number): Budget {
    if (existsSync(file)) {
      const l = JSON.parse(readFileSync(file, "utf8")) as Ledger;
      if (l.quoteId !== token.quoteId) throw new MixtapeError(`spend.json belongs to ${l.quoteId}, not ${token.quoteId}. Move it aside before running a new approval.`);
      return new Budget(file, l, creditsPerUsd);
    }
    const l: Ledger = { quoteId: token.quoteId, maxCredits: token.maxCredits, maxUsd: token.maxUsd, spentCredits: 0, spentUsd: 0, entries: [] };
    const b = new Budget(file, l, creditsPerUsd);
    b.save();
    return b;
  }

  get spent(): { credits: number; usd: number } {
    return { credits: this.ledger.spentCredits, usd: this.ledger.spentUsd };
  }

  get remaining(): { credits: number; usd: number } {
    return { credits: this.ledger.maxCredits - this.ledger.spentCredits, usd: Math.round((this.ledger.maxUsd - this.ledger.spentUsd) * 1e6) / 1e6 };
  }

  /** Dollars spent outside credits (narration), summed exactly from the entries. */
  private otherUsd(): number {
    // `other` is stored exactly; older entries without it are credit-only (diff is rounding noise).
    return this.ledger.entries.reduce((a, e) => {
      const diff = e.usd - e.credits / this.creditsPerUsd;
      return a + (e.other ?? (Math.abs(diff) < 1e-5 ? 0 : diff));
    }, 0);
  }

  /**
   * Would this cost fit? Credits are also counted in dollars against the approved total. The dollar
   * side is recomputed exactly (credits / rate + narration), not from rounded per-entry sums, which
   * once blocked the last of 8 approved stills by $0.00004 (regression test).
   */
  fits(credits: number, usd: number): boolean {
    const usdAfter = (this.ledger.spentCredits + credits) / this.creditsPerUsd + this.otherUsd() + usd;
    return this.ledger.spentCredits + credits <= this.ledger.maxCredits && usdAfter <= this.ledger.maxUsd + 1e-6;
  }

  /** Record a cost before the call is made; throws (and records nothing) if it would pass the approval. */
  reserve(what: string, credits: number, usd: number): void {
    if (!this.fits(credits, usd)) {
      throw new MixtapeError(
        `STOP: ${what} (${credits} cr, $${usd.toFixed(3)}) would pass the approved ${this.ledger.maxCredits} cr / $${this.ledger.maxUsd.toFixed(2)} (spent ${this.ledger.spentCredits} cr / $${this.ledger.spentUsd.toFixed(2)}). Nothing more was billed; re-quote to continue.`,
      );
    }
    const totalUsd = usd + credits / this.creditsPerUsd;
    this.ledger.spentCredits += credits;
    this.ledger.spentUsd = Math.round((this.ledger.spentUsd + totalUsd) * 1e6) / 1e6;
    this.ledger.entries.push({ at: new Date().toISOString(), what, credits, usd: Math.round(totalUsd * 1e6) / 1e6, other: usd });
    this.save();
  }

  private save(): void {
    writeFileSync(this.file, JSON.stringify(this.ledger, null, 2) + "\n");
  }
}
