import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { drawEnvelope, envelopeLeft, grantEnvelope, parseEnvelope, readEnvelope } from "./envelope.js";

const dir = mkdtempSync(join(tmpdir(), "mx-envelope-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("parseEnvelope", () => {
  it("reads credits and narration dollars in the ways people write them", () => {
    expect(parseEnvelope("1000cr $1.50")).toEqual({ credits: 1000, usd: 1.5 });
    expect(parseEnvelope("1000 cr, $1.5")).toEqual({ credits: 1000, usd: 1.5 });
    expect(parseEnvelope("1000:1.5")).toEqual({ credits: 1000, usd: 1.5 });
    expect(parseEnvelope("1000/0")).toEqual({ credits: 1000, usd: 0 });
    expect(parseEnvelope("400 credits 2 usd")).toEqual({ credits: 400, usd: 2 });
  });
  it("refuses a grant with one number missing, or out of range", () => {
    expect(() => parseEnvelope("1000")).toThrow(/credits AND narration dollars/);
    expect(() => parseEnvelope("$5")).toThrow(/credits AND/);
    expect(() => parseEnvelope("12.5cr $1")).toThrow(/whole number/);
    expect(() => parseEnvelope("100cr $500")).toThrow(/0-100/);
  });
});

describe("drawEnvelope", () => {
  it("approves quotes while they fit, reserves the full quote, never draws the same quote twice, and says why when one doesn't fit", () => {
    expect(drawEnvelope(dir, { id: "q-aaaaaaaaaa", credits: 10, voiceUsd: 0 })).toMatchObject({ ok: false, why: /no envelope/ });
    grantEnvelope(dir, { credits: 300, usd: 0.1 });
    expect(drawEnvelope(dir, { id: "q-aaaaaaaaaa", credits: 0, voiceUsd: 0.06 })).toEqual({ ok: true, left: { credits: 300, usd: 0.04 } });
    expect(drawEnvelope(dir, { id: "q-aaaaaaaaaa", credits: 0, voiceUsd: 0.06 })).toEqual({ ok: true, left: { credits: 300, usd: 0.04 } });
    expect(drawEnvelope(dir, { id: "q-bbbbbbbbbb", credits: 84, voiceUsd: 0 })).toEqual({ ok: true, left: { credits: 216, usd: 0.04 } });
    expect(drawEnvelope(dir, { id: "q-cccccccccc", credits: 250, voiceUsd: 0 })).toMatchObject({ ok: false, why: /250 cr.*216 cr/ });
    expect(drawEnvelope(dir, { id: "q-dddddddddd", credits: 0, voiceUsd: 0.05 })).toMatchObject({ ok: false, why: /\$0\.05 narration.*\$0\.04/ });
    const e = readEnvelope(dir);
    expect(e?.approved.map((a) => a.quoteId)).toEqual(["q-aaaaaaaaaa", "q-bbbbbbbbbb"]);
    expect(e && envelopeLeft(e)).toEqual({ credits: 216, usd: 0.04 });
    expect(JSON.parse(readFileSync(join(dir, "envelope.json"), "utf8"))).toMatchObject({ maxCredits: 300, maxUsd: 0.1 });
    // a new grant starts over
    grantEnvelope(dir, { credits: 50, usd: 0 });
    expect(readEnvelope(dir)?.approved).toEqual([]);
  });
});
