import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { scriptSchema, type Script } from "../schema/script.js";
import { approveQuote, buildQuote, type Rates } from "./quote.js";
import { buildPlan, sheetPrompt, shotPrompt } from "./plan.js";

const sample = (): Script => scriptSchema.parse(JSON.parse(readFileSync(new URL("../../fixtures/script.sample.json", import.meta.url), "utf8")));
const rates: Rates = { creditsPerStill: 12, creditsPerVideoSec: 18, creditsPerUsd: 113, voiceUsdPer1kChars: 0.15, ceilingUsd: 5 };

describe("buildPlan", () => {
  it("makes one shot per hook/beat with the export-contract fields", () => {
    const plan = buildPlan(sample(), "plateful-fw1");
    expect(plan.shots.map((s) => s.beat)).toEqual(["HOOK", "PROBLEM", "DEMO", "PROOF", "CTA"]);
    expect(plan.shots[0]).toMatchObject({ n: 1, vo: "Your meal plan isn't the problem.", set: "KITCHEN", t_target: [0, 2.5], end_card: false });
    expect(plan.shots.at(-1)?.end_card).toBe(true);
    expect(plan.shots[1]?.chars).toEqual(["MAYA"]);
  });

  it("plans one sheet per cast member, plates for sets used by 2+ shots, one still per shot", () => {
    const plan = buildPlan(sample(), "plateful-fw1");
    expect(plan.stills.filter((j) => j.kind === "sheet").map((j) => j.id)).toEqual(["sheet_MAYA"]);
    // KITCHEN has 3 shots; LIVING and AISLE have 1 each
    expect(plan.stills.filter((j) => j.kind === "plate").map((j) => j.id)).toEqual(["plate_KITCHEN"]);
    expect(plan.stills.filter((j) => j.kind === "shot")).toHaveLength(5);
  });

  it("attaches the cast sheet and set plate as references to each shot", () => {
    const plan = buildPlan(sample(), "plateful-fw1");
    const shot2 = plan.stills.find((j) => j.id === "shot_02");
    expect(shot2?.refs).toEqual(["sheet_MAYA"]);
    const shot1 = plan.stills.find((j) => j.id === "shot_01");
    expect(shot1?.refs).toEqual(["plate_KITCHEN"]);
  });

  it("never attaches a plate to a close-up (Seedream copies the plate's camera: the live calendar close-up came out as the empty kitchen)", () => {
    const plan = buildPlan(sample(), "plateful-fw1");
    // shot_04 = proof, KITCHEN, camera "close, straight on"
    expect(plan.stills.find((j) => j.id === "shot_04")?.refs).toEqual([]);
  });

  it("tells the model to take only the room's layout from an attached plate", () => {
    const plan = buildPlan(sample(), "plateful-fw1");
    expect(plan.stills.find((j) => j.id === "shot_01")?.prompt).toMatch(/plate_KITCHEN reference shows the room only/);
    expect(plan.stills.find((j) => j.id === "shot_02")?.prompt).not.toMatch(/reference shows the room only/);
  });

  it("gives every still a hash of exactly what it would generate", () => {
    const a = buildPlan(sample(), "x").stills;
    const s = sample();
    const b4 = s.beats[2];
    if (!b4) throw new Error("fixture");
    b4.visual = "a big wall calendar, four takeout stickers, three crossed out in red marker";
    const b = buildPlan(s, "x").stills;
    const changed = a.filter((j, i) => j.hash !== b[i]?.hash).map((j) => j.id);
    expect(changed).toEqual(["shot_04"]);
  });

  it("voices every line, or none for a captions-only format", () => {
    expect(buildPlan(sample(), "x").voice.text).toContain("Your meal plan isn't the problem. By Wednesday");
    const s = sample();
    s.audio.voice = "no VO; on-screen text carries the story";
    expect(buildPlan(s, "x").voice).toEqual({ mode: "none", text: "", chars: 0 });
  });
});

describe("prompts", () => {
  it("shot prompts carry style, set, camera, identity, wardrobe, action and state, and forbid text", () => {
    const s = sample();
    const first = s.beats[0];
    if (!first) throw new Error("fixture");
    const p = shotPrompt(s, first);
    for (const part of ["Bright clean lifestyle illustration", "INTERIOR ONLY: a small apartment living room", "Night light.", "medium, slightly high", "woman in her thirties", "oversized grey knit sweater", "on the sofa, tired", "No text, no logos"]) {
      expect(p).toContain(part);
    }
  });

  it("every still forbids real people, brands and existing characters but allows invented poster art (loosened 2026-11-07)", () => {
    for (const j of buildPlan(sample(), "x").stills) {
      expect(j.prompt, j.id).toMatch(/no real people, celebrities, brands or existing characters/i);
      expect(j.prompt, j.id).toMatch(/invented/i);
    }
  });

  it("the CTA shot keeps the top third calm for the offer card, without asking for empty space (drawn as a black band, ep 5)", () => {
    const s = sample();
    const cta = s.beats.at(-1);
    if (!cta) throw new Error("fixture");
    const p = shotPrompt(s, cta, true);
    expect(p).toMatch(/top third .*calm/i);
    expect(p).toMatch(/fills the whole frame/i);
    expect(p).not.toMatch(/empty space/i);
  });

  it("character sheets show identity and default wardrobe on a plain background", () => {
    const p = sheetPrompt(sample(), "MAYA");
    expect(p).toContain("woman in her thirties");
    expect(p).toContain("oversized grey knit sweater");
    expect(p).toMatch(/plain light background/);
  });
});

describe("quote", () => {
  it("prices stills and narration in credits and dollars", () => {
    const plan = buildPlan(sample(), "plateful-fw1");
    const q = buildQuote(plan, rates);
    // 1 sheet + 1 plate + 5 shots = 7 stills x 12 cr
    expect(q.credits).toBe(84);
    expect(q.stillsUsd).toBeCloseTo(84 / 113, 4);
    expect(q.voiceUsd).toBeCloseTo((plan.voice.chars / 1000) * 0.15, 6);
    expect(q.usd).toBeCloseTo(q.stillsUsd + q.voiceUsd, 6);
    expect(q.overCeiling).toBe(false);
    expect(q.estimate).toBe(true);
  });

  it("the quote id is stable for the same plan and changes when a prompt changes", () => {
    const a = buildQuote(buildPlan(sample(), "x"), rates).id;
    expect(buildQuote(buildPlan(sample(), "x"), rates).id).toBe(a);
    const s = sample();
    s.style_lock.style_prompt = "pencil sketch, 9:16";
    expect(buildQuote(buildPlan(s, "x"), rates).id).not.toBe(a);
    expect(a).toMatch(/^q-[0-9a-f]{10}$/);
  });

  it("charges nothing for stills already on file from the same prompt (retakes pay only for what changed)", () => {
    const plan = buildPlan(sample(), "x");
    const onFile = new Set(plan.stills.filter((j) => j.id !== "shot_04").map((j) => j.id));
    const q = buildQuote(plan, rates, { onFile, voiceCachedChars: plan.voice.chars });
    expect(q.credits).toBe(12);
    expect(q.voiceUsd).toBe(0);
    expect(q.items.find((i) => i.label === "on file")).toMatchObject({ units: 6, credits: 0, usd: 0 });
  });

  it("flags a quote over the ceiling", () => {
    expect(buildQuote(buildPlan(sample(), "x"), { ...rates, ceilingUsd: 0.5 }).overCeiling).toBe(true);
  });
});

describe("approveQuote", () => {
  const plan = buildPlan(sample(), "x");
  const q = buildQuote(plan, rates);

  it("returns a token only for the current quote's id", () => {
    expect(approveQuote(q, q.id)).toMatchObject({ quoteId: q.id, maxUsd: q.usd, maxCredits: q.credits });
    expect(() => approveQuote(q, "q-0000000000")).toThrow(/does not match/);
  });

  it("refuses a quote over the ceiling even with the right id", () => {
    const over = buildQuote(plan, { ...rates, ceilingUsd: 0.5 });
    expect(() => approveQuote(over, over.id)).toThrow(/ceiling/);
  });
});
