import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { judgeSync, lineLock, speechSpan, tightRef, REF_LEAD_S, REF_TAIL_S } from "./sync.js";

const dir = mkdtempSync(join(tmpdir(), "mx-sync-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** Synthetic "line": silence, a tone burst (speech), silence. */
function voice(file: string, lead: number, speech: number, tail: number): string {
  const total = lead + speech + tail;
  execFileSync("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", `sine=frequency=220:sample_rate=48000:duration=${total}`,
    "-af", `volume='if(between(t,${lead},${lead + speech}),1,0)':eval=frame`,
    "-c:a", "pcm_s16le", file,
  ]);
  return file;
}

describe("speechSpan", () => {
  it("finds where the voice starts and ends inside the silence", async () => {
    const f = voice(join(dir, "take.wav"), 1.0, 2.0, 0.8);
    const s = await speechSpan(f);
    expect(s).not.toBeNull();
    expect(s?.start).toBeCloseTo(1.0, 1);
    expect(s?.end).toBeCloseTo(3.0, 1);
  });
  it("is null for silence", async () => {
    const f = voice(join(dir, "silent.wav"), 2, 0, 0);
    expect(await speechSpan(f)).toBeNull();
  });
});

describe("tightRef", () => {
  it("cuts the lead to REF_LEAD_S and leaves REF_TAIL_S after the last word (rule 0 step 1: no slack)", async () => {
    const line = voice(join(dir, "line.wav"), 0.9, 1.5, 1.2);
    const r = await tightRef(line, join(dir, "refs", "clip_01.wav"));
    expect(existsSync(r.file)).toBe(true);
    expect(r.span.start).toBeCloseTo(REF_LEAD_S, 1);
    expect(r.seconds).toBeCloseTo(REF_LEAD_S + 1.5 + REF_TAIL_S, 1);
    const again = await speechSpan(r.file);
    expect(again?.start ?? 9).toBeLessThan(0.2);
  });

  it("pads the ref with silence to the clip's full length when asked (no room to re-time the line)", async () => {
    const line = voice(join(dir, "short.wav"), 0.3, 1.2, 0.5);
    const r = await tightRef(line, join(dir, "refs", "clip_02.wav"), 4);
    expect(r.seconds).toBe(4);
    const probe = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", r.file], { encoding: "utf8" });
    expect(Number(probe)).toBeCloseTo(4, 1);
    expect((await speechSpan(r.file))?.end ?? 9).toBeLessThan(1.6);
  });
});

describe("judgeSync (0.85–1.18x gate)", () => {
  const take = { start: 0.1, end: 2.1 };
  it("passes inside the band and fails outside, at both edges", () => {
    expect(judgeSync({ start: 0.3, end: 2.3 }, take)).toMatchObject({ ratio: 1, pass: true });
    expect(judgeSync({ start: 0, end: 1.7 }, take)).toMatchObject({ ratio: 0.85, pass: true });
    expect(judgeSync({ start: 0, end: 1.68 }, take).pass).toBe(false);
    expect(judgeSync({ start: 0, end: 2.36 }, take)).toMatchObject({ ratio: 1.18, pass: true });
    expect(judgeSync({ start: 0, end: 2.4 }, take).pass).toBe(false);
    expect(judgeSync(null, take)).toMatchObject({ pass: false, why: "no speech heard in the clip" });
  });
});

describe("lineLock (one speed + offset)", () => {
  it("speeds the clip by the ratio within 0.9–1.1 and trims its head so the first word lands on the take's", () => {
    expect(lineLock({ ratio: 1.05, clipStart: 0.6, pass: true, why: "" }, 0.2)).toEqual({ trimStart: 0.39, speed: 1.05 });
    expect(lineLock({ ratio: 1.18, clipStart: 0.1, pass: true, why: "" }, 0.5)).toEqual({ trimStart: 0, speed: 1.1 });
    expect(lineLock({ ratio: 0.85, clipStart: 0, pass: true, why: "" }, 0)).toEqual({ trimStart: 0, speed: 0.9 });
  });
});
