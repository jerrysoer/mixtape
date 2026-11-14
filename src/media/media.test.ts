import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { assertPublicHttpsUrl, isPrivateAddress, safeHost } from "./download.js";
import { extractFrames, pickFrameTimes } from "./keyframes.js";
import { nearestAspect, parseProbe, probe } from "./probe.js";
import { cleanCuts, detectScenes, parseShowinfo, scenesFromCuts } from "./scenes.js";
import { parseFasterWhisper, parseWhisperCpp, suppliedTranscript } from "./transcribe.js";

describe("probe", () => {
  it("parses ffprobe JSON", () => {
    const json = JSON.stringify({ format: { duration: "24.04" }, streams: [{ codec_type: "video", width: 720, height: 1280 }, { codec_type: "audio" }] });
    expect(parseProbe(json)).toEqual({ duration_s: 24.04, width: 720, height: 1280, hasAudio: true });
  });

  it("maps sizes to the nearest standard aspect", () => {
    expect(nearestAspect(720, 1280)).toBe("9:16");
    expect(nearestAspect(1080, 1350)).toBe("4:5");
    expect(nearestAspect(1080, 1080)).toBe("1:1");
    expect(nearestAspect(1920, 1080)).toBe("16:9");
  });
});

describe("scenes", () => {
  it("parses showinfo lines and merges near-duplicate cuts", () => {
    const stderr = "[Parsed_showinfo_1] n:0 pts:100 pts_time:2.5 ...\n[Parsed_showinfo_1] n:1 pts_time:2.6\n[x] pts_time:7.04\n[x] pts_time:23.9";
    expect(parseShowinfo(stderr)).toEqual([2.5, 2.6, 7.04, 23.9]);
    expect(cleanCuts(parseShowinfo(stderr), 24)).toEqual([2.5, 7.04]);
  });

  it("turns cuts into contiguous scenes", () => {
    expect(scenesFromCuts([2.5, 7], 10)).toEqual([{ t: [0, 2.5] }, { t: [2.5, 7] }, { t: [7, 10] }]);
  });
});

describe("keyframes", () => {
  it("always includes a hook frame and an end frame", () => {
    expect(pickFrameTimes([{ t: [0, 4] }, { t: [4, 10] }], 10)).toEqual([0.5, 2, 7, 9.5]);
  });

  it("caps the frame count with an even spread", () => {
    const scenes = Array.from({ length: 40 }, (_, i) => ({ t: [i, i + 1] as [number, number] }));
    const times = pickFrameTimes(scenes, 40, 16);
    expect(times).toHaveLength(16);
    expect(times[0]).toBe(0.5);
    expect(times.at(-1)).toBe(39.5);
  });
});

describe("transcripts", () => {
  it("parses whisper-cpp JSON and drops [MUSIC] tags", () => {
    const json = JSON.stringify({ transcription: [{ offsets: { from: 0, to: 1500 }, text: " [MUSIC]" }, { offsets: { from: 1500, to: 4000 }, text: " Stop doing cardio." }] });
    expect(parseWhisperCpp(json)).toEqual({ engine: "whisper-cpp", segments: [{ t: [1.5, 4], text: "Stop doing cardio." }], text: "Stop doing cardio." });
  });

  it("parses faster-whisper JSON", () => {
    const t = parseFasterWhisper(JSON.stringify({ segments: [{ start: 0, end: 2, text: " Hi." }] }));
    expect(t.text).toBe("Hi.");
  });

  it("caps a supplied transcript", () => {
    expect(suppliedTranscript("x".repeat(30_000)).text).toHaveLength(20_000);
  });
});

describe("download guard", () => {
  it("never exposes the signed query string", () => {
    expect(safeHost("https://video.example.net/v/ad.mp4?oh=SECRET&oe=123")).toBe("video.example.net");
  });

  it("flags private and loopback addresses", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.20.0.1", "192.168.1.5", "169.254.169.254", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1", "100.64.0.1"]) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
    expect(isPrivateAddress("31.13.71.1")).toBe(false);
  });

  it("refuses http, credentials and local hosts", async () => {
    await expect(assertPublicHttpsUrl("http://example.com/a.mp4")).rejects.toThrow(/https/);
    await expect(assertPublicHttpsUrl("https://user:pw@example.com/a.mp4")).rejects.toThrow(/credentials/);
    await expect(assertPublicHttpsUrl("https://localhost/a.mp4")).rejects.toThrow(/local/);
    await expect(assertPublicHttpsUrl("https://127.0.0.1/a.mp4")).rejects.toThrow(/private/);
    await expect(assertPublicHttpsUrl("https://[::1]/a.mp4")).rejects.toThrow(/private/);
  });
});

/** Real ffmpeg round trip on a generated 3-scene clip (skipped when ffmpeg is missing). */
const hasFfmpeg = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!hasFfmpeg)("ffmpeg pipeline", () => {
  const dir = mkdtempSync(join(tmpdir(), "mx-media-"));
  const clip = join(dir, "clip.mp4");
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("probes, finds the hard cuts and extracts frames", async () => {
    // red 2 s, green 2 s, blue 2 s at 360x640 (9:16)
    const colors = ["red", "lime", "blue"];
    const inputs = colors.flatMap((c) => ["-f", "lavfi", "-i", `color=c=${c}:s=360x640:d=2:r=25`]);
    execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...inputs, "-filter_complex", "[0][1][2]concat=n=3:v=1:a=0", "-pix_fmt", "yuv420p", clip]);
    const info = await probe(clip);
    expect(info).toMatchObject({ width: 360, height: 640, hasAudio: false });
    expect(info.duration_s).toBeCloseTo(6, 0);
    const scenes = await detectScenes(clip, info.duration_s);
    expect(scenes.map((s) => Math.round(s.t[0]))).toEqual([0, 2, 4]);
    const frames = await extractFrames(clip, pickFrameTimes(scenes, info.duration_s), dir);
    expect(frames.length).toBeGreaterThanOrEqual(3);
    expect(readdirSync(dir).filter((f) => f.endsWith(".jpg"))).toHaveLength(frames.length);
  }, 30_000);
});
