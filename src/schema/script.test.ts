import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkClaims } from "../guard/claims.js";
import { checkTiming } from "../guard/timing.js";
import { formatIssues } from "./structure.js";
import { scriptLines, scriptSchema, type Script } from "./script.js";

const sample = (): Script => JSON.parse(readFileSync(new URL("../../fixtures/script.sample.json", import.meta.url), "utf8")) as Script;

function issues(s: unknown): string[] {
  const r = scriptSchema.safeParse(s);
  return r.success ? [] : formatIssues(r.error);
}

describe("script.json schema", () => {
  it("accepts the Plateful fixture", () => {
    expect(issues(sample())).toEqual([]);
  });

  it("the fixture passes its own timing and claims checks", () => {
    const s = sample();
    const lines = scriptLines(s);
    expect(checkTiming(lines.map((l) => ({ path: l.path, t: l.t, line: l.text })), s.structure.duration_s, false).errors).toEqual([]);
    expect(checkClaims(lines, s.brief)).toEqual([]);
  });

  it("rejects a shot whose set is not defined", () => {
    const s = sample();
    s.hook.shot.set = "GARAGE";
    expect(issues(s).join()).toMatch(/set GARAGE is not in sets/);
  });

  it("rejects people missing from cast, and wardrobe keys that don't exist", () => {
    const a = sample();
    const b0 = a.beats[0];
    if (!b0) throw new Error("fixture");
    b0.shot.people = { ...b0.shot.people, LEO: "standing" };
    expect(issues(a).join()).toMatch(/LEO is not in cast/);
    const b = sample();
    const b1 = b.beats[0];
    if (!b1) throw new Error("fixture");
    b1.shot.wear = { MAYA: "pajamas" };
    expect(issues(b).join()).toMatch(/wardrobe MAYA\.pajamas is not defined/);
  });

  it("rejects unused cast and sets", () => {
    const s = sample();
    s.sets = { ...s.sets, ROOF: "EXTERIOR ONLY: a flat roof at dusk, open sky" };
    expect(issues(s).join()).toMatch(/set ROOF is never used/);
  });

  it("requires set descriptions to start INTERIOR ONLY / EXTERIOR ONLY", () => {
    const s = sample();
    s.sets = { ...s.sets, AISLE: "a supermarket aisle" };
    expect(issues(s).join()).toMatch(/INTERIOR ONLY/);
  });

  it("rejects a broken timeline and extra keys", () => {
    const s = sample();
    const last = s.beats.at(-1);
    if (!last) throw new Error("fixture");
    last.t = [20, 26];
    expect(issues(s).join()).toMatch(/duration_s is 24/);
    expect(issues({ ...sample(), notes: "x" }).length).toBeGreaterThan(0);
  });
});
