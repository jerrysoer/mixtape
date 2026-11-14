import { describe, expect, it } from "vitest";
import { HOOK_PATTERNS } from "../schema/structure.js";
import { HOOK_MAX_WORDS, checkHooks, hookScore, type ScoredHook } from "./score.js";
import { HOOK_TEMPLATES, fillTemplate, templateHooks } from "./templates.js";

type RawHook = Omit<ScoredHook, "score">;

/** Ten distinct, valid hooks with spread scores; override any by index. */
function makeHooks(overrides: Record<number, Partial<RawHook>> = {}): RawHook[] {
  const base = Array.from({ length: 10 }, (_, i) => ({
    text: `POV: your dial-up dies at ${90 + i} percent`,
    scroll: (i % 5) + 4,
    curiosity: ((i + 2) % 5) + 3,
    fit: ((i + 4) % 4) + 5,
  }));
  return base.map((h, i) => ({ ...h, ...overrides[i] }));
}

const ctx = { sourceText: "", brand: "" };

describe("hookScore", () => {
  it("weights scroll 0.45, curiosity 0.35, fit 0.2", () => {
    expect(hookScore({ scroll: 10, curiosity: 0, fit: 0 })).toBe(4.5);
    expect(hookScore({ scroll: 0, curiosity: 10, fit: 0 })).toBe(3.5);
    expect(hookScore({ scroll: 0, curiosity: 0, fit: 10 })).toBe(2);
    expect(hookScore({ scroll: 7, curiosity: 6, fit: 9 })).toBe(7.05);
  });

  it("is monotonic in each dimension", () => {
    const base = { scroll: 5, curiosity: 5, fit: 5 };
    for (const k of ["scroll", "curiosity", "fit"] as const) {
      expect(hookScore({ ...base, [k]: 6 })).toBeGreaterThan(hookScore(base));
    }
  });
});

describe("checkHooks", () => {
  it("ranks ten valid hooks and keeps the top five, best first", () => {
    const r = checkHooks({ hooks: makeHooks() }, ctx);
    expect(r.errors).toEqual([]);
    expect(r.ranked).toHaveLength(10);
    expect(r.top).toHaveLength(5);
    const scores = r.ranked.map((h) => h.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    expect(r.top).toEqual(r.ranked.slice(0, 5));
  });

  it("breaks score ties by original order (stable)", () => {
    const hooks = makeHooks({ 3: { scroll: 10, curiosity: 10, fit: 10 }, 7: { scroll: 10, curiosity: 10, fit: 10 } });
    const r = checkHooks({ hooks }, ctx);
    expect(r.ranked[0]?.text).toBe(hooks[3]?.text);
    expect(r.ranked[1]?.text).toBe(hooks[7]?.text);
  });

  it("requires exactly ten hooks", () => {
    expect(checkHooks({ hooks: makeHooks().slice(0, 9) }, ctx).errors.join()).toMatch(/10/);
  });

  it(`allows ${HOOK_MAX_WORDS} words and rejects ${HOOK_MAX_WORDS + 1}`, () => {
    const twelve = "one two three four five six seven eight nine ten eleven twelve";
    expect(checkHooks({ hooks: makeHooks({ 0: { text: twelve } }) }, ctx).errors).toEqual([]);
    expect(checkHooks({ hooks: makeHooks({ 0: { text: `${twelve} thirteen` } }) }, ctx).errors.join()).toMatch(/hooks\.0: 13 words/);
  });

  it("applies a tighter word limit for a spoken hook window", () => {
    const six = "one two three four five six";
    expect(checkHooks({ hooks: makeHooks({ 0: { text: "one two three four five" } }) }, { ...ctx, maxWords: 5 }).errors.join()).not.toMatch(/hooks\.0/);
    expect(checkHooks({ hooks: makeHooks({ 0: { text: six } }) }, { ...ctx, maxWords: 5 }).errors.join()).toMatch(/hooks\.0: 6 words \(max 5\)/);
  });

  it("rejects scores outside 1-10 and non-integers", () => {
    expect(checkHooks({ hooks: makeHooks({ 0: { scroll: 0 } }) }, ctx).errors.length).toBeGreaterThan(0);
    expect(checkHooks({ hooks: makeHooks({ 0: { fit: 11 } }) }, ctx).errors.length).toBeGreaterThan(0);
    expect(checkHooks({ hooks: makeHooks({ 0: { curiosity: 6.5 } }) }, ctx).errors.length).toBeGreaterThan(0);
  });

  it("rejects duplicates that differ only in case and punctuation", () => {
    const r = checkHooks({ hooks: makeHooks({ 1: { text: "pov  your DIAL-UP dies at 90 percent!" } }) }, ctx);
    expect(r.errors.join()).toMatch(/hooks\.1: duplicates hooks\.0/);
  });

  it("rejects a lazy judge: a dimension with fewer than 3 distinct scores", () => {
    const flat = makeHooks().map((h, i) => ({ ...h, curiosity: i % 2 ? 7 : 8 }));
    expect(checkHooks({ hooks: flat }, ctx).errors.join()).toMatch(/curiosity: only 2 distinct scores/);
  });

  it("rejects a hook that copies 5+ words from the source ad", () => {
    const r = checkHooks({ hooks: makeHooks({ 2: { text: "Stop doing cardio before breakfast, seriously" } }) }, { sourceText: "Stop doing cardio before breakfast. Fuelwell fixes it.", brand: "" });
    expect(r.errors.join()).toMatch(/hooks\.2: shares 5 words/);
  });

  it("rejects a source line with one word swapped (near-copy)", () => {
    const source = "I just came across Sarah's order and I had to share this one with you.";
    const r = checkHooks({ hooks: makeHooks({ 0: { text: "I just came across Tammy's order and had to share" } }) }, { sourceText: source, brand: "" });
    expect(r.errors.join()).toMatch(/hooks\.0: near-copy of a source line \(90% of its words in order\)/);
  });

  it("rejects a hook that names the source brand", () => {
    const r = checkHooks({ hooks: makeHooks({ 4: { text: "Why Northpeak Sleep pillows lie to you" } }) }, { sourceText: "", brand: "Northpeak Sleep" });
    expect(r.errors.join()).toMatch(/hooks\.4: names the source brand/);
  });

  it("rejects extra keys", () => {
    expect(checkHooks({ hooks: makeHooks(), notes: "x" }, ctx).errors.length).toBeGreaterThan(0);
  });
});

describe("template fallback", () => {
  it("has five templates for every hook pattern", () => {
    for (const p of HOOK_PATTERNS) expect(HOOK_TEMPLATES[p], p).toHaveLength(5);
  });

  it("fills {x} lowercase and {X} capitalized", () => {
    expect(fillTemplate("{X} for less than a coffee. Seriously, {x}.", "Dial-up Internet")).toBe("Dial-up internet for less than a coffee. Seriously, dial-up internet.");
  });

  it("returns five unscored candidates within the word limit", () => {
    const hooks = templateHooks("number_shock", "ringtone subscriptions");
    expect(hooks).toHaveLength(5);
    for (const h of hooks) expect(h.split(/\s+/).length).toBeLessThanOrEqual(HOOK_MAX_WORDS);
  });
});
