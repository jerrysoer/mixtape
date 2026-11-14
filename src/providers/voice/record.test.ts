import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { Budget } from "../../render/budget.js";
import type { ApprovalToken } from "../../render/quote.js";
import { evenWords, recordEleven, splitWordsByLine, takeBody, takeText } from "./record.js";

const dir = mkdtempSync(join(tmpdir(), "mx-voice-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("evenWords", () => {
  it("spreads a line's words over its length by character count", () => {
    const w = evenWords("Hi there", 1);
    expect(w.map((x) => x.w)).toEqual(["Hi", "there"]);
    expect(w[0]?.s).toBe(0);
    expect(w[1]?.e).toBeCloseTo(1, 3);
  });
});

/** A real 1 s MP3 so ffmpeg can decode the fake ElevenLabs reply. */
const mp3b64 = (() => {
  const f = join(dir, "tone.mp3");
  execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=330:duration=1", "-c:a", "libmp3lame", f]);
  return readFileSync(f).toString("base64");
})();

function fakeEleven(calls: { url: string; body: { text: string; seed?: number } }[]): typeof fetch {
  return (async (url: string | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { text: string; seed?: number };
    calls.push({ url: String(url), body });
    const chars = [...body.text];
    const t = chars.map((_, i) => (i / chars.length) * 0.9);
    return new Response(JSON.stringify({ audio_base64: mp3b64, alignment: { characters: chars, character_start_times_seconds: t, character_end_times_seconds: t.map((x) => x + 0.02) } }), { status: 200 });
  }) as typeof fetch;
}

const token = (maxUsd: number) => ({ quoteId: "q-voice00000", maxCredits: 0, maxUsd }) as ApprovalToken;

describe("recordEleven (fetch faked at the network boundary)", () => {
  it("records the whole ad as ONE take (tag + settings sent), splits the words back into shots, cuts a line file per shot, and caches", async () => {
    const calls: { url: string; body: { text: string; voice_settings?: unknown } }[] = [];
    const lines = [{ shot: 1, text: "Stop scrolling." }, { shot: 2, text: "Try it free, [laughs] today." }];
    const budget = Budget.open(join(dir, "spend1.json"), token(1), 113);
    const r = await recordEleven(lines, join(dir, "v1"), { key: "k", voiceId: "voice123", model: "eleven_v4", usdPer1kChars: 0.15, budget, fetchImpl: fakeEleven(calls), hear: async () => "", deliveryTag: "[casual]", voiceSettings: { stability: 0.35, similarity_boost: 0.8 } });
    expect(calls.map((c) => c.body.text)).toEqual(["[casual] Stop scrolling. Try it free, [laughs] today."]);
    expect(calls[0]?.body.voice_settings).toEqual({ stability: 0.35, similarity_boost: 0.8 });
    expect(calls[0]?.url).toContain("/v1/text-to-speech/voice123/with-timestamps");
    expect(r.words.map((w) => [w.w, w.shot])).toEqual([["Stop", 1], ["scrolling.", 1], ["Try", 2], ["it", 2], ["free,", 2], ["today.", 2]]);
    expect(r.words[2]?.s).toBeGreaterThan(r.words[1]?.e ?? 1);
    expect(existsSync(join(dir, "v1", "lines", "line_01.wav"))).toBe(true);
    expect(existsSync(join(dir, "v1", "lines", "line_02.wav"))).toBe(true);
    expect(existsSync(join(dir, "v1", "narration.wav"))).toBe(true);
    expect(budget.spent.usd).toBeCloseTo((calls[0]?.body.text.length ?? 0) / 1000 * 0.15, 6);
    // second run: all cached, nothing billed
    const again: typeof calls = [];
    await recordEleven(lines, join(dir, "v1"), { key: "k", voiceId: "voice123", model: "eleven_v4", usdPer1kChars: 0.15, budget, fetchImpl: fakeEleven(again), hear: async () => "", deliveryTag: "[casual]", voiceSettings: { stability: 0.35, similarity_boost: 0.8 } });
    expect(again).toHaveLength(0);
  }, 30_000);

  it("retakes on a new seed when the take repeats a phrase", async () => {
    const calls: { url: string; body: { text: string; seed?: number } }[] = [];
    let n = 0;
    const hear = async () => (n++ === 0 ? "the bar the bar the bar is at eighty seven" : "the bar is at eighty seven");
    const budget = Budget.open(join(dir, "spend2.json"), token(1), 113);
    const r = await recordEleven([{ shot: 1, text: "The bar is at eighty seven." }], join(dir, "v2"), { key: "k", voiceId: "v", model: "eleven_v3", usdPer1kChars: 0.15, budget, fetchImpl: fakeEleven(calls), hear });
    expect(calls.map((c) => c.body.seed)).toEqual([undefined, 1]);
    expect(r.takes.map((t) => t.verdict)).toEqual([expect.stringMatching(/repeats/), "ok"]);
  }, 30_000);

  it("stops before a call that would pass the approved dollars", async () => {
    const calls: { url: string; body: { text: string } }[] = [];
    const budget = Budget.open(join(dir, "spend3.json"), token(0.001), 113);
    await expect(recordEleven([{ shot: 1, text: "x".repeat(100) }], join(dir, "v3"), { key: "k", voiceId: "v", model: "eleven_v3", usdPer1kChars: 0.15, budget, fetchImpl: fakeEleven(calls), hear: async () => "" })).rejects.toThrow(/STOP/);
    expect(calls).toHaveLength(0);
  });
});

describe("splitWordsByLine", () => {
  const w = (xs: string[]) => xs.map((x, i) => ({ w: x, s: i, e: i + 0.5 }));
  it("hands each line its words in order and refuses a count that doesn't add up", () => {
    const lines = [{ shot: 1, text: "Okay so, don't laugh." }, { shot: 3, text: "[laughs] It worked." }];
    expect(takeText(lines)).toBe("Okay so, don't laugh. [laughs] It worked.");
    expect(takeBody("x", "[tag]")).toBe("[tag] x");
    const split = splitWordsByLine(w(["Okay", "so,", "don't", "laugh.", "It", "worked."]), lines);
    expect(split.map((x) => x.shot)).toEqual([1, 1, 1, 1, 3, 3]);
    expect(() => splitWordsByLine(w(["Okay", "so,"]), lines)).toThrow(/fewer words/);
    expect(() => splitWordsByLine(w(["a", "b", "c", "d", "e", "f", "g"]), lines)).toThrow(/more word/);
  });
});
