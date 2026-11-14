import { describe, expect, it } from "vitest";
import { listFormatIds, loadFormat } from "../formats.js";
import { RULES_TEXT, structureSchema, timelineIssues } from "./structure.js";

function at<T>(xs: T[], i: number): T {
  const x = xs[i];
  if (x === undefined) throw new Error(`no item ${i}`);
  return x;
}

const valid = () => ({
  source: { platform: "meta", kind: "meta", ad_id: "1234567890", page_name: "Fuelwell", days_running: 286, variants: 14 },
  duration_s: 24,
  aspect: "9:16",
  format: "founder_talking_head",
  hook: { t: [0, 2.5], pattern: "contrarian_reveal", text_role: "denies the obvious answer", candidates: [] },
  beats: [
    { t: [2.5, 7], role: "problem", visual: "close-up, relatable frustration", caption_style: "bold white, 2 lines, center-safe" },
    { t: [7, 14], role: "demo", visual: "product in real use, handheld" },
    { t: [14, 20], role: "proof", visual: "result on screen, number overlay" },
    { t: [20, 24], role: "cta", visual: "product hero + offer card" },
  ],
  audio: { music: "upbeat lo-fi 100-110 bpm", sfx: ["whoosh on cuts"], voice: "creator VO" },
  rules: RULES_TEXT,
});

describe("structure.json schema", () => {
  it("accepts the PRD example", () => {
    expect(structureSchema.safeParse(valid()).success).toBe(true);
  });

  it("rejects unknown keys (no smuggled transcript field)", () => {
    const s = { ...valid(), transcript: "hey guys" };
    expect(structureSchema.safeParse(s).success).toBe(false);
  });

  it("rejects an unknown hook pattern and beat role", () => {
    const a = valid();
    a.hook.pattern = "clickbait";
    expect(structureSchema.safeParse(a).success).toBe(false);
    const b = valid();
    at(b.beats, 0).role = "vibes";
    expect(structureSchema.safeParse(b).success).toBe(false);
  });

  it("rejects gaps, overlaps and a wrong end time", () => {
    const gap = valid();
    at(gap.beats, 1).t = [8, 14];
    expect(structureSchema.safeParse(gap).success).toBe(false);
    const end = valid();
    end.duration_s = 30;
    expect(timelineIssues(end).map((i) => i.message)).toEqual(["last beat ends at 24 but duration_s is 30"]);
  });

  it("tolerates rounding up to 0.25 s", () => {
    const s = valid();
    at(s.beats, 1).t = [7.2, 14];
    expect(structureSchema.safeParse(s).success).toBe(true);
  });

  it("rejects over-long descriptions", () => {
    const s = valid();
    at(s.beats, 0).visual = "x ".repeat(150);
    expect(structureSchema.safeParse(s).success).toBe(false);
  });

  it("upload sources keep a basename, never a path", () => {
    const s = { ...valid(), source: { kind: "upload", file_name: "/Users/me/ad.mp4" } };
    expect(structureSchema.safeParse(s).success).toBe(false);
    const ok = { ...valid(), source: { kind: "upload", file_name: "ad.mp4" } };
    expect(structureSchema.safeParse(ok).success).toBe(true);
  });
});

describe("format library", () => {
  it("ships F1-F14", () => {
    expect(listFormatIds()).toEqual(Array.from({ length: 14 }, (_, i) => `F${i + 1}`));
  });

  it.each(Array.from({ length: 14 }, (_, i) => `F${i + 1}`))("%s is schema-valid, 9:16 and 15-25 s", (id) => {
    const s = loadFormat(id);
    expect(s.source).toMatchObject({ kind: "template", id });
    expect(s.aspect).toBe("9:16");
    expect(s.duration_s).toBeGreaterThanOrEqual(15);
    expect(s.duration_s).toBeLessThanOrEqual(25);
  });

  it("accepts lowercase ids and rejects junk", () => {
    expect(loadFormat("f3").source).toMatchObject({ id: "F3" });
    expect(() => loadFormat("../etc/passwd")).toThrow(/not a format id/);
    expect(() => loadFormat("F99")).toThrow(/No built-in format/);
  });
});
