import { describe, expect, it } from "vitest";
import { longestSharedRun, nearCopy, quotedSpans, words } from "./overlap.js";

describe("words", () => {
  it("normalizes case, punctuation and curly apostrophes", () => {
    expect(words("You’ve been doing it WRONG, honestly!")).toEqual(["you've", "been", "doing", "it", "wrong", "honestly"]);
  });
});

describe("longestSharedRun", () => {
  const source = "Most people think protein shakes taste like chalk. Ours tastes like a milkshake you can drink every day.";

  it("finds a copied run regardless of case and punctuation", () => {
    const hit = longestSharedRun("ours TASTES like a milkshake you can drink", source, 6);
    expect(hit).toEqual({ run: "ours tastes like a milkshake you can drink", length: 8 });
  });

  it("ignores runs shorter than the threshold", () => {
    expect(longestSharedRun("it tastes like a cloud", source, 6)).toBeNull();
  });

  it("reports the longest of several runs", () => {
    const hit = longestSharedRun("protein shakes taste like chalk and ours tastes like a milkshake you can", source, 4);
    expect(hit).toEqual({ run: "ours tastes like a milkshake you can", length: 7 });
  });
});

describe("nearCopy", () => {
  const source = "Most mornings I just came across a customer's order and I had to share this one with you today.";

  it("catches a line copied with one word swapped (defeats run-length checks)", () => {
    const hit = nearCopy("I just came across Tammy's order and had to share", "I just came across Sarah's order and I had to share this one with you.");
    expect(hit?.ratio).toBeCloseTo(0.9, 2);
  });

  it("ignores short lines and loose resemblance", () => {
    expect(nearCopy("came across her order", source)).toBeNull(); // under 6 words
    expect(nearCopy("POV: your dial-up dies at 99 percent tonight", source)).toBeNull();
  });

  it("does not count words scattered far apart in a long source", () => {
    const scattered = "the cat " + "filler ".repeat(40) + "sat on " + "filler ".repeat(40) + "the warm mat";
    expect(nearCopy("the cat sat on the warm mat", scattered)).toBeNull();
  });

  it("flags at the 75% boundary, not below", () => {
    // 8 words, 6 in order in the source = 0.75
    expect(nearCopy("alpha beta gamma delta epsilon zeta xx yy", "alpha beta gamma delta epsilon zeta eta theta")?.ratio).toBe(0.75);
    // 8 words, 5 in order = 0.625
    expect(nearCopy("alpha beta gamma delta epsilon xx yy zz", "alpha beta gamma delta epsilon zeta eta theta")).toBeNull();
  });
});

describe("quotedSpans", () => {
  it("flags quoted lines but not short labels", () => {
    expect(quotedSpans('on-screen text "POV:" then "you are 87% done downloading"', 4)).toEqual(["you are 87% done downloading"]);
    expect(quotedSpans("caption 'BEFORE' on the left", 4)).toEqual([]);
    expect(quotedSpans("text reads 'stop doing cardio like this'", 4)).toEqual(["stop doing cardio like this"]);
  });
});
