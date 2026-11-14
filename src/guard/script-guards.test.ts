import { describe, expect, it } from "vitest";
import { CLAIM_ROLES, checkClaims, numbersIn } from "./claims.js";
import { ORIGINALITY_MAX_RUN, checkOriginality } from "./originality.js";
import { WORDS_PER_SECOND, checkTiming, spokenSeconds, type TimedLine } from "./timing.js";

// Fictional source (CLAUDE.md fixtures rule)
const SOURCE = "Stop doing cardio before breakfast. Fuelwell gives you thirty grams of protein in a shake that tastes like dessert. Get yours today.";

describe("checkOriginality (render guard: no run of more than 6 words)", () => {
  it(`passes a ${ORIGINALITY_MAX_RUN - 1}-word shared run and blocks ${ORIGINALITY_MAX_RUN}`, () => {
    // "gives you thirty grams of protein" = 6 shared words: allowed
    expect(checkOriginality([{ path: "beats.0.line", text: "Plateful gives you thirty grams of protein, sort of" }], SOURCE).errors).toEqual([]);
    // "gives you thirty grams of protein in" = 7: blocked
    const r = checkOriginality([{ path: "beats.0.line", text: "it gives you thirty grams of protein in one meal" }], SOURCE);
    expect(r.errors.join()).toMatch(/beats\.0\.line: shares 7 words/);
    expect(r.maxRun).toBe(7);
  });

  it("blocks a near-copy with a swapped word", () => {
    const r = checkOriginality([{ path: "hook.line", text: "Stop doing yoga before breakfast" }], SOURCE);
    expect(r.errors).toEqual([]); // 5 words: under the near-copy minimum
    const r2 = checkOriginality([{ path: "hook.line", text: "A shake that tastes like dinner, get yours today" }], SOURCE);
    expect(r2.errors.join()).toMatch(/hook\.line: near-copy/);
  });

  it("passes everything when there is no source text (templates)", () => {
    expect(checkOriginality([{ path: "x", text: SOURCE }], "").errors).toEqual([]);
  });

  it("reports the worst run across all lines", () => {
    const r = checkOriginality(
      [
        { path: "a", text: "nothing shared here at all today friend" },
        { path: "b", text: "thirty grams of protein in a cup" },
      ],
      SOURCE,
    );
    expect(r.maxRun).toBe(6); // "thirty grams of protein in a"
  });
});

describe("numbersIn", () => {
  it("normalizes digits, money, percents and number words", () => {
    expect([...numbersIn("From 4 takeout nights to one, $9.99 a week, 87% done, fourteen days")].sort()).toEqual(["1", "14", "4", "87", "9.99"]);
    expect([...numbersIn("twenty-seven vitamins, 1,360g, forty grams")].sort()).toEqual(["1360", "27", "40"]);
  });
});

describe("checkClaims (proof lines use brief facts only)", () => {
  const brief = "Plateful plans a week of meals in 2 minutes. In a 2026 beta, testers went from 4 takeout nights a week to 1. Offer: 14-day free trial.";

  it("accepts numbers that appear in the brief, written either way", () => {
    expect(checkClaims([{ path: "beats.2.line", role: "proof", text: "Testers went from four takeout nights to one." }], brief)).toEqual([]);
  });

  it("rejects a number the brief doesn't contain", () => {
    expect(checkClaims([{ path: "beats.2.line", role: "proof", text: "Testers saved 6 hours a week." }], brief).join()).toMatch(/beats\.2\.line: "6" is not in the brief/);
  });

  it("rejects strong claim words the brief doesn't back", () => {
    expect(checkClaims([{ path: "beats.2.line", role: "social_proof", text: "Clinically proven to end takeout." }], brief).join()).toMatch(/"clinically"/);
  });

  it("only checks claim roles", () => {
    expect(CLAIM_ROLES).toContain("proof");
    expect(checkClaims([{ path: "beats.0.line", role: "problem", text: "By 9pm you've ordered 3 times." }], brief)).toEqual([]);
  });
});

describe("timing (±10% at ~2.5 words/sec)", () => {
  it("estimates speech at 2.5 words per second", () => {
    expect(WORDS_PER_SECOND).toBe(2.5);
    expect(spokenSeconds("one two three four five")).toBe(2);
  });

  const parts = (lines: string[]): TimedLine[] => lines.map((line, i) => ({ path: `p${i}`, t: [i * 4, i * 4 + 4] as [number, number], line }));
  const words = (n: number) => Array.from({ length: n }, () => "word").join(" ");

  it("passes when total speech is within ±10% of the ad length", () => {
    // 2 windows of 4 s = 8 s; 20 words = 8 s
    expect(checkTiming(parts([words(10), words(10)]), 8, false)).toMatchObject({ errors: [], withinPct: true });
  });

  it("fails a line that overruns its window by more than 10%", () => {
    // 12 words = 4.8 s in a 4 s window (> 4.4 s)
    const r = checkTiming(parts([words(12), words(8)]), 8, false);
    expect(r.errors.join()).toMatch(/p0: ~4\.8 s of speech in a 4\.0 s window/);
  });

  it("allows exactly +10% in a window", () => {
    // 11 words = 4.4 s in 4 s = 1.10x
    expect(checkTiming(parts([words(11), words(9)]), 8, false).errors).toEqual([]);
  });

  it("skips the window check for on-screen lines (a caption hook holds into the next beat)", () => {
    const p = parts([words(12), words(8)]);
    const first = p[0];
    if (!first) throw new Error("parts");
    p[0] = { ...first, onScreen: true };
    expect(checkTiming(p, 8, true).errors).toEqual([]);
  });

  it("fails a script far shorter than the ad, unless it is captions-only", () => {
    expect(checkTiming(parts([words(4), words(4)]), 8, false).errors.join()).toMatch(/total ~3\.2 s of speech for the 8\.0 s ad/);
    expect(checkTiming(parts([words(4), words(4)]), 8, true).errors).toEqual([]);
  });
});
