import { describe, expect, it } from "vitest";
import { rankWithinBrand, winnerScore } from "./winner.js";

describe("winnerScore", () => {
  it("weights days 0.6 and variants 0.25, renormalized when reach is unknown", () => {
    expect(winnerScore({ days: 1, variants: 1, reach: null })).toBe(1);
    expect(winnerScore({ days: 1, variants: 0, reach: null })).toBeCloseTo(0.6 / 0.85, 3);
    expect(winnerScore({ days: 0, variants: 1, reach: null })).toBeCloseTo(0.25 / 0.85, 3);
  });

  it("uses the 0.15 reach weight when reach is known", () => {
    expect(winnerScore({ days: 1, variants: 0, reach: 0 })).toBeCloseTo(0.6, 3);
    expect(winnerScore({ days: 0, variants: 0, reach: 1 })).toBeCloseTo(0.15, 3);
  });
});

describe("rankWithinBrand", () => {
  it("normalizes within the brand and sorts best first; a tie goes to the older ad, then the id", () => {
    const ranked = rankWithinBrand([
      { id: "a", days: 10, variants: 1 },
      { id: "d", days: 200, variants: 1 },
      { id: "c", days: 100, variants: 9 },
      { id: "b", days: 200, variants: 1 },
      { id: "e", days: 150, variants: 3.5 },
    ]);
    // e: (0.6·140/190 + 0.25·2.5/8)/0.85 ≈ 0.612 and c: (0.6·90/190 + 0.25)/0.85 ≈ 0.628 tie-free; b,d tie on score and days
    expect(ranked.map((r) => r.id)).toEqual(["b", "d", "c", "e", "a"]);
    expect(ranked[0]?.score).toBeCloseTo(0.6 / 0.85, 3);
    expect(ranked[2]?.score).toBeCloseTo((0.6 * (90 / 190) + 0.25) / 0.85, 3);
    expect(ranked.at(-1)?.score).toBe(0);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 3, 4, 5]);
  });

  it("gives every ad full marks on a metric when the brand has no spread", () => {
    const ranked = rankWithinBrand([
      { id: "x", days: 30, variants: 2 },
      { id: "y", days: 30, variants: 2 },
    ]);
    expect(ranked.map((r) => r.score)).toEqual([1, 1]);
  });
});
