import { describe, expect, it } from "vitest";
import { CTA_HOLD_S, TAIL_S, captionChunks, lineCaptions, shotTimes, type Word } from "./timeline.js";

const w = (text: string, s: number, e: number, shot: number): Word => ({ w: text, s, e, shot });

// shot 1: "Stop scrolling now." 0.1-1.5 ; shot 2: "Dinner is late again tonight, sorry." 1.9-4.2 ; shot 3: "Try it free." 4.6-5.6
const WORDS: Word[] = [
  w("Stop", 0.1, 0.5, 1), w("scrolling", 0.5, 1.0, 1), w("now.", 1.0, 1.5, 1),
  w("Dinner", 1.9, 2.3, 2), w("is", 2.3, 2.5, 2), w("late", 2.5, 2.9, 2), w("again", 2.9, 3.3, 2), w("tonight,", 3.3, 3.8, 2), w("sorry.", 3.8, 4.2, 2),
  w("Try", 4.6, 4.9, 3), w("it", 4.9, 5.1, 3), w("free.", 5.1, 5.6, 3),
];

describe("shotTimes (narrated)", () => {
  it("cuts each shot on its line's first word, starts at 0, and holds the end card", () => {
    const t = shotTimes({ shots: [{ n: 1, t_target: [0, 2] }, { n: 2, t_target: [2, 5] }, { n: 3, t_target: [5, 7] }], endCard: true }, WORDS);
    expect(t.slice(0, 2)).toEqual([
      { n: 1, start: 0, end: 1.9 },
      { n: 2, start: 1.9, end: 4.6 },
    ]);
    expect(t[2]).toMatchObject({ n: 3, start: 4.6 });
    expect(t[2]?.end).toBeCloseTo(5.6 + TAIL_S + CTA_HOLD_S, 6);
  });

  it("leaves no gaps: each shot ends where the next starts", () => {
    const t = shotTimes({ shots: [{ n: 1, t_target: [0, 2] }, { n: 2, t_target: [2, 5] }, { n: 3, t_target: [5, 7] }], endCard: false }, WORDS);
    for (let i = 1; i < t.length; i++) expect(t[i]?.start).toBe(t[i - 1]?.end);
    expect(t.at(-1)?.end).toBeCloseTo(5.6 + TAIL_S, 6);
  });

  it("refuses words for a shot that has none (a line the narration dropped)", () => {
    expect(() => shotTimes({ shots: [{ n: 1, t_target: [0, 2] }, { n: 2, t_target: [2, 4] }], endCard: false }, WORDS.filter((x) => x.shot === 1))).toThrow(/shot 2 has no narrated words/);
  });
});

describe("shotTimes (captions-only)", () => {
  it("uses the structure's windows", () => {
    expect(shotTimes({ shots: [{ n: 1, t_target: [0, 2] }, { n: 2, t_target: [2, 6] }], endCard: false }, null)).toEqual([
      { n: 1, start: 0, end: 2 },
      { n: 2, start: 2, end: 6 },
    ]);
  });
});

describe("captionChunks (word-by-word)", () => {
  it("groups at most 3 words, never across a sentence end or a shot", () => {
    const c = captionChunks(WORDS, 3);
    // "again tonight," closes on its comma (2+ words), so "sorry." stands alone
    expect(c.map((x) => x.text)).toEqual(["STOP SCROLLING NOW.", "DINNER IS LATE", "AGAIN TONIGHT,", "SORRY.", "TRY IT FREE."]);
  });

  it("breaks after a comma when the group is already 2+ words", () => {
    const c = captionChunks([w("Plan", 0, 0.3, 1), w("it,", 0.3, 0.6, 1), w("shop", 0.6, 0.9, 1), w("it.", 0.9, 1.2, 1)], 3);
    expect(c.map((x) => x.text)).toEqual(["PLAN IT,", "SHOP IT."]);
  });

  it("each chunk shows from its first word until the next chunk (or briefly after its last word)", () => {
    const c = captionChunks(WORDS, 3);
    expect(c[0]).toMatchObject({ start: 0.1, end: 1.9 }); // held through the pause before the next line
    expect(c[1]).toMatchObject({ start: 1.9, end: 2.9 });
    expect(c.at(-1)?.end).toBeCloseTo(5.6 + 0.4, 6); // last chunk lingers 0.4 s
  });

  it("caps a hold across a long pause at 0.8 s past the last word", () => {
    const c = captionChunks([w("One.", 0, 0.4, 1), w("Two.", 3, 3.4, 2)], 3);
    expect(c[0]?.end).toBeCloseTo(1.2, 6);
  });
});

describe("lineCaptions (captions-only formats)", () => {
  it("shows each shot's whole line for its window", () => {
    const c = lineCaptions([{ n: 1, vo: "POV: 87% done", t: { start: 0, end: 2 } }, { n: 2, vo: "Then: the dial tone.", t: { start: 2, end: 6 } }]);
    expect(c).toEqual([
      { text: "POV: 87% done", start: 0, end: 2 },
      { text: "Then: the dial tone.", start: 2, end: 6 },
    ]);
  });
});
