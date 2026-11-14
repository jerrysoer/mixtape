import { describe, expect, it } from "vitest";
import { charsToWords, heardWrong, offsetWords } from "./align.js";

describe("charsToWords", () => {
  it("turns ElevenLabs character timings into word timings", () => {
    const text = "Stop it. Now";
    const chars = [...text];
    const starts = chars.map((_, i) => i * 0.1);
    const ends = chars.map((_, i) => i * 0.1 + 0.1);
    expect(charsToWords(chars, starts, ends)).toEqual([
      { w: "Stop", s: 0, e: 0.4 },
      { w: "it.", s: 0.5, e: 0.8 },
      { w: "Now", s: 0.9, e: 1.2 },
    ]);
  });

  it("drops [performance tags] so they never become caption words", () => {
    const text = "[excited] Go now";
    const chars = [...text];
    const t = chars.map((_, i) => i * 0.05);
    expect(charsToWords(chars, t, t.map((x) => x + 0.05)).map((w) => w.w)).toEqual(["Go", "now"]);
  });
});

describe("offsetWords", () => {
  it("shifts each line's words by its offset and tags the shot", () => {
    expect(offsetWords([{ w: "Hi.", s: 0.1, e: 0.4 }], 2.5, 3)).toEqual([{ w: "Hi.", s: 2.6, e: 2.9, shot: 3 }]);
  });
});

describe("heardWrong (v3 repeats phrases; alignment hides it)", () => {
  const want = "Seven minutes in and the bar is at eighty seven percent";
  it("passes a faithful read", () => {
    expect(heardWrong("seven minutes in and the bar is at eighty-seven percent", want)).toBe("");
  });
  it("flags a repeated phrase the script doesn't have", () => {
    expect(heardWrong("seven minutes in and the bar the bar is at eighty seven percent the bar is at", want)).toMatch(/repeats/);
  });
  it("flags 3+ missing words", () => {
    expect(heardWrong("seven minutes in and the bar", want)).toMatch(/not heard/);
  });
  it("trusts silence from the checker (no evidence)", () => {
    expect(heardWrong("", want)).toBe("");
  });
});
