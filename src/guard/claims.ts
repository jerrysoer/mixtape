import type { BeatRole } from "../schema/structure.js";
import { words } from "./overlap.js";

/**
 * Claims guard (PRD F4, `checks.claims_in_brief`): lines in claim-bearing beats may only
 * state numbers that appear in the brief, and may not use strong claim words the brief
 * doesn't itself use. Non-numeric claims beyond these words rely on the press prompt rule.
 */
export const CLAIM_ROLES: readonly BeatRole[] = ["proof", "social_proof", "authority", "comparison", "after", "offer", "urgency", "cta"];

/** Words that make a regulated or checkable claim. Allowed only when the brief uses them. */
export const STRONG_CLAIM_WORDS = ["clinically", "clinical", "proven", "scientifically", "guaranteed", "guarantee", "doctor", "doctors", "dermatologist", "dermatologists", "fda", "cure", "cures", "certified", "#1"];

const UNITS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };

/** Every number in the text, normalized to a digit string: "$1,360.50" → "1360.5", "twenty-seven" → "27". */
export function numbersIn(text: string): Set<string> {
  const found = new Set<string>();
  for (const m of text.matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
    const n = Number(m[0].replace(/,/g, ""));
    if (Number.isFinite(n)) found.add(String(n));
  }
  const ws = text.toLowerCase().split(/[^a-z]+/).filter(Boolean);
  for (let i = 0; i < ws.length; i++) {
    const w = ws[i] ?? "";
    const tens = TENS[w];
    if (tens !== undefined) {
      const unit = UNITS[ws[i + 1] ?? ""];
      if (unit !== undefined && unit > 0 && unit < 10) {
        found.add(String(tens + unit));
        i++;
      } else found.add(String(tens));
      continue;
    }
    const unit = UNITS[w];
    if (unit !== undefined) found.add(String(unit));
    else if (w === "hundred") found.add("100");
  }
  return found;
}

export interface ClaimLine {
  path: string;
  role: BeatRole | "hook";
  text: string;
}

export function checkClaims(lines: ClaimLine[], brief: string): string[] {
  const errors: string[] = [];
  const briefNumbers = numbersIn(brief);
  const briefWords = new Set(words(brief));
  const briefLower = brief.toLowerCase();
  for (const { path, role, text } of lines) {
    if (role === "hook" || !CLAIM_ROLES.includes(role)) continue;
    for (const n of numbersIn(text)) {
      if (!briefNumbers.has(n)) errors.push(`${path}: "${n}" is not in the brief; claim lines may only use the brief's facts`);
    }
    const lineWords = new Set(words(text));
    for (const w of STRONG_CLAIM_WORDS) {
      const inLine = w.startsWith("#") ? text.toLowerCase().includes(w) : lineWords.has(w);
      const inBrief = w.startsWith("#") ? briefLower.includes(w) : briefWords.has(w);
      if (inLine && !inBrief) errors.push(`${path}: "${w}" is a strong claim the brief doesn't make`);
    }
  }
  return errors;
}
