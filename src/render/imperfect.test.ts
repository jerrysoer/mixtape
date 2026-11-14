import { describe, expect, it } from "vitest";
import { imperfect, imperfectLines, splitClauses } from "./imperfect.js";

const TAKE =
  "Okay so, don't laugh. My Walkman ate my tape. Like, actually ate it, there was ribbon everywhere. " +
  "And I'm just standing there, and my brother goes, \"use a pencil.\" You stick it in the little hole and wind it back. " +
  "And it… worked? It's fine now. The headphones squeak, the clip's broken, I don't even care. Honestly, five stars. Just bring a pencil.";

describe("splitClauses", () => {
  it("splits on sentence and comma boundaries and keeps the punctuation on each clause", () => {
    const c = splitClauses("Okay so, don't laugh. And it… worked? Fine.");
    expect(c).toEqual(["Okay so,", " don't laugh.", " And it… worked?", " Fine."]);
    expect(c.join("")).toBe("Okay so, don't laugh. And it… worked? Fine.");
  });
});

describe("imperfect (10–20% natural disfluency, seeded)", () => {
  it("rate 0 returns the text untouched", () => {
    expect(imperfect(TAKE, { rate: 0, seed: 1 })).toEqual({ text: TAKE, changes: [] });
  });

  it("is deterministic for a seed and different across seeds", () => {
    const a = imperfect(TAKE, { rate: 0.15, seed: 7 });
    const b = imperfect(TAKE, { rate: 0.15, seed: 7 });
    const c = imperfect(TAKE, { rate: 0.15, seed: 8 });
    expect(a).toEqual(b);
    expect(c.text).not.toBe(a.text);
  });

  it("touches about rate × clauses, never the first (hook) or last (landing) clause, never two in a row", () => {
    const clauses = splitClauses(TAKE);
    for (const rate of [0.1, 0.15, 0.2]) {
      const r = imperfect(TAKE, { rate, seed: 3 });
      expect(r.changes.length).toBe(Math.max(1, Math.round(clauses.length * rate)));
      const idx = r.changes.map((x) => x.clause).sort((x, y) => x - y);
      expect(idx[0]).toBeGreaterThan(0);
      expect(idx.at(-1)).toBeLessThan(clauses.length - 1);
      for (let i = 1; i < idx.length; i++) expect((idx[i] ?? 0) - (idx[i - 1] ?? 0)).toBeGreaterThan(1);
    }
  });

  it("clamps the rate to 0.3 and uses at most one laugh", () => {
    const r = imperfect(TAKE, { rate: 0.9, seed: 2 });
    expect(r.changes.length).toBe(Math.round(splitClauses(TAKE).length * 0.3));
    expect(r.changes.filter((x) => x.kind === "laugh").length).toBeLessThanOrEqual(1);
  });

  it("each kind reads as speech, not a label", () => {
    const t = "Hi there. The tape got stuck. Bye now.";
    const one = (kind: "restart" | "trail" | "laugh" | "filler" | "hedge" | "breath") =>
      imperfect(t, { rate: 0.5, seed: 1, kinds: [kind] }).text;
    expect(one("restart")).toBe("Hi there. The— the tape got stuck. Bye now.");
    expect(one("trail")).toBe("Hi there. The tape got stuck… Bye now.");
    expect(one("laugh")).toBe("Hi there. [laughs] The tape got stuck. Bye now.");
    expect(one("breath")).toBe("Hi there. [exhales] The tape got stuck. Bye now.");
    expect(one("filler")).toMatch(/^Hi there\. (Like|I mean|Um|Honestly), the tape got stuck\. Bye now\.$/);
    expect(one("hedge")).toMatch(/^Hi there\. The tape got stuck, (kind of|I guess|sort of)\. Bye now\.$/);
  });
});

describe("imperfectLines (a script's lines as one monologue)", () => {
  const lines = ["Okay so, don't laugh.", "My Walkman ate my tape. Like, actually ate it, there was ribbon everywhere.", "And it… worked? It's fine now.", "Honestly, five stars. Just bring a pencil."];
  it("returns one line per line, leaves the hook and the last clause alone, and picks the same clauses as the joined text", () => {
    const r = imperfectLines(lines, { rate: 0.2, seed: 5 });
    expect(r.lines).toHaveLength(4);
    expect(r.lines[0]).toBe(lines[0]);
    expect(r.lines[3]?.endsWith("Just bring a pencil.")).toBe(true);
    expect(r.changes).toEqual(imperfect(lines.join(" "), { rate: 0.2, seed: 5 }).changes);
    expect(r.lines.join(" ")).toBe(imperfect(lines.join(" "), { rate: 0.2, seed: 5 }).text);
  });
});
