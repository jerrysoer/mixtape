import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { scriptSchema, type Script } from "../schema/script.js";
import { buildClipPlan, clipPrompt, clipSeconds, defaultMotion, enoughClip } from "./motion.js";
import { buildPlan } from "./plan.js";
import { buildQuote, quoteId, type Rates } from "./quote.js";

const sample = (): Script => scriptSchema.parse(JSON.parse(readFileSync(new URL("../../fixtures/script.sample.json", import.meta.url), "utf8")));
const rates: Rates = { creditsPerStill: 12, creditsPerVideoSec: 18, creditsPerUsd: 113, voiceUsdPer1kChars: 0.15, ceilingUsd: 10 };
const at = <T,>(xs: readonly T[], i = 0): T => {
  const x = xs[i];
  if (x === undefined) throw new Error(`no item `);
  return x;
};
const times = (plan: ReturnType<typeof buildPlan>) => plan.shots.map((s) => ({ n: s.n, start: s.t_target[0], end: s.t_target[1] }));

describe("clipSeconds", () => {
  it("rounds the shot window up to whole seconds, never under 4 or over 30", () => {
    expect(clipSeconds(2.4)).toBe(4);
    expect(clipSeconds(4.05)).toBe(4); // a hair of slack
    expect(clipSeconds(4.2)).toBe(5);
    expect(clipSeconds(9.1)).toBe(9);
    expect(clipSeconds(31)).toBe(30);
  });
});

describe("enoughClip (reuse a clip a touch shorter than its new window)", () => {
  it("accepts up to 10% short, refuses more", () => {
    expect(enoughClip(7, 7)).toBe(true);
    expect(enoughClip(6.3, 7)).toBe(true);
    expect(enoughClip(6, 7)).toBe(false);
    expect(enoughClip(10, 11)).toBe(true);
    expect(enoughClip(5, 6)).toBe(false);
  });
});

describe("clipPrompt", () => {
  const plan = buildPlan(sample(), "p", "motion");
  it("holds the first frame, closes mouths when nobody speaks, and names the speaker when one does", () => {
    const silent = clipPrompt(plan.style, at(plan.shots));
    expect(silent).toContain("Start exactly on the first frame");
    expect(silent).toContain("Nobody speaks; every mouth stays closed.");
    expect(silent).toContain(`Motion: ${defaultMotion(at(plan.shots).camera)}`);
    const talking = clipPrompt(plan.style, { ...at(plan.shots), speaker: "MAYA", motion: "slow push in; she lifts the box" });
    expect(talking).toContain("MAYA speaks to camera");
    expect(talking).toContain("Mouth moving naturally with the words");
    expect(clipPrompt(plan.style, { ...at(plan.shots), speaker: "MAYA" }, true)).toContain("Lips follow {{audio}} exactly");
    expect(talking).toContain("Motion: slow push in; she lifts the box.");
    expect(talking).not.toContain("every mouth stays closed");
  });
  it("close-ups creep, wider shots drift", () => {
    expect(defaultMotion("extreme close-up")).toMatch(/push in/);
    expect(defaultMotion("medium, eye level")).toMatch(/handheld/);
  });
});

describe("buildClipPlan", () => {
  it("makes one clip per shot from its still, skips still-only shots, and prices silent shots on the cheaper model when given", () => {
    const plan = buildPlan(sample(), "p", "motion");
    const clips = buildClipPlan(plan, times(plan), { model: "seedance_2.5", silentModel: "seedance_2.0_mini", stillOnly: new Set(["clip_03"]) });
    expect(clips.map((c) => c.id)).toEqual(["clip_01", "clip_02", "clip_04", "clip_05"]);
    expect(clips[0]).toMatchObject({ still: "shot_01", shot: 1, speaker: null, model: "seedance_2.0_mini" });
    expect(clips.every((c) => c.seconds >= 4 && c.seconds <= 30)).toBe(true);
    const top = buildClipPlan(plan, times(plan), { model: "seedance_2.5" });
    expect(top).toHaveLength(5);
    expect(new Set(top.map((c) => c.model))).toEqual(new Set(["seedance_2.5"]));
  });

  it("hashes change with the still, the motion and the length", () => {
    const plan = buildPlan(sample(), "p", "motion");
    const a = at(buildClipPlan(plan, times(plan), { model: "m" }));
    const moved = at(buildClipPlan({ ...plan, shots: plan.shots.map((s, i) => (i ? s : { ...s, motion: "whip pan" })) }, times(plan), { model: "m" }));
    const longer = at(buildClipPlan(plan, times(plan).map((t, i) => (i ? t : { ...t, end: t.end + 20 })), { model: "m" }));
    const newStill = at(buildClipPlan({ ...plan, stills: plan.stills.map((j) => (j.id === "shot_01" ? { ...j, hash: "different" } : j)) }, times(plan), { model: "m" }));
    expect(new Set([a.hash, moved.hash, longer.hash, newStill.hash]).size).toBe(4);
  });
});

describe("clip-stage quote", () => {
  it("bills clip seconds at the video rate, keeps on-file clips at 0, and changes the id with the stage", () => {
    const plan = buildPlan(sample(), "p", "motion");
    const stillsId = quoteId(plan, rates);
    plan.stage = "clips";
    plan.clips = buildClipPlan(plan, times(plan), { model: "seedance_2.5" });
    const secs = plan.clips.reduce((a, c) => a + c.seconds, 0);
    const onFile = new Set(plan.stills.map((j) => j.id));
    const q = buildQuote(plan, rates, { onFile });
    expect(q.id).not.toBe(stillsId);
    expect(q.items.find((i) => i.label.startsWith("clips ("))).toMatchObject({ units: secs, credits: secs * 18 });
    expect(q.items.find((i) => i.label === "on file")?.units).toBe(plan.stills.length);
    const q2 = buildQuote(plan, rates, { onFile: new Set([...onFile, "clip_01", "clip_02"]) });
    expect(q2.credits).toBe((secs - at(plan.clips).seconds - at(plan.clips, 1).seconds) * 18);
    expect(q2.items.find((i) => i.label === "clips on file")?.units).toBe(2);
    expect(q2.id).not.toBe(q.id);
  });

  it("stills-stage ids are unchanged by the motion fields (old approvals stay valid)", () => {
    const still = buildPlan(sample(), "p", "still");
    const motion = buildPlan(sample(), "p", "motion");
    expect(quoteId(still, rates)).toBe(quoteId(motion, rates));
  });
});
