import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { LUFS, buildCut, captionTrackList, cardText, escapeImText, normalizeNarration, segmentArgs } from "./assemble.js";
import { captionChunks, shotTimes, type Word } from "./timeline.js";

describe("escapeImText", () => {
  it("neutralises ImageMagick's @file and % escapes", () => {
    expect(escapeImText("87% done")).toBe("87%% done");
    expect(escapeImText("@/etc/passwd")).toBe("\\@/etc/passwd");
    expect(escapeImText("a\\b")).toBe("a\\\\b");
  });
});

describe("cardText", () => {
  it("drops v4 delivery tags so the end card never prints [laughs]", () => {
    expect(cardText("[laughs] It's fine now. The headphones squeak, [exhales] the clip's broken.")).toBe("It's fine now. The headphones squeak, the clip's broken.");
  });
});

describe("captionTrackList", () => {
  it("fills gaps with the blank frame, covers 0..total and repeats the last file", () => {
    const list = captionTrackList([{ file: "/c1.png", start: 0.5, end: 1.5 }, { file: "/c2.png", start: 1.5, end: 2 }], "/blank.png", 3);
    expect(list.split("\n").filter(Boolean)).toEqual([
      "file '/blank.png'", "duration 0.500",
      "file '/c1.png'", "duration 1.000",
      "file '/c2.png'", "duration 0.500",
      "file '/blank.png'", "duration 1.000",
      "file '/blank.png'",
    ]);
  });

  it("quotes paths with apostrophes", () => {
    expect(captionTrackList([], "/Jerry's/blank.png", 1)).toContain("file '/Jerry'\\''s/blank.png'");
  });
});

describe("segmentArgs", () => {
  it("alternates push-in and pull-out and renders exact frames at 30 fps", () => {
    const a = segmentArgs("/s.png", 2, 0, "/o.mp4").join(" ");
    const b = segmentArgs("/s.png", 2, 1, "/o.mp4").join(" ");
    expect(a).toContain("z='1+0.08*on/60'");
    expect(b).toContain("z='1.08-0.08*on/60'");
    expect(a).toContain("-frames:v 60");
  });
});

const hasTools = (() => {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    execFileSync("magick", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();
const FONT = "/System/Library/Fonts/Supplemental/DIN Condensed Bold.ttf";

const hasSay = (() => {
  try {
    execFileSync("say", ["-v", "?"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!hasTools || !hasSay)("normalizeNarration", () => {
  it("lands a quiet, peaky narration within 0.5 LU of -14 LUFS without clipping (live v3 fell back to dynamic and hit -15.2)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "mx-loud-"));
    const speech = join(dir, "speech.aiff");
    execFileSync("say", ["-o", speech, "Seven minutes in. The bar is at eighty seven percent. Then the dial tone. Download failed."]);
    // real speech, peaks pushed near full scale but quiet on average (like v3: -17.3 LUFS, -0.3 dBTP)
    const src = join(dir, "peaky.wav");
    execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", speech, "-af", "volume=-6dB,alimiter=limit=0.97:level=false,volume=2dB", "-ar", "48000", src]);
    const out = join(dir, "norm.wav");
    await normalizeNarration(src, out);
    const stderr = execFileSync("sh", ["-c", `ffmpeg -hide_banner -nostats -i "${out}" -af ebur128=peak=true -f null - 2>&1`], { encoding: "utf8" });
    const i = Number(/I:\s+(-?[\d.]+) LUFS/.exec(stderr.split("Summary:")[1] ?? "")?.[1]);
    const peak = Number(/Peak:\s+(-?[\d.]+) dBFS/.exec(stderr.split("Summary:")[1] ?? "")?.[1]);
    expect(Math.abs(i - LUFS)).toBeLessThanOrEqual(0.5);
    expect(peak).toBeLessThanOrEqual(-1.0);
    rmSync(dir, { recursive: true, force: true });
  }, 60_000);
});

describe.skipIf(!hasTools || !existsSync(FONT))("buildCut (real ffmpeg + ImageMagick, free)", () => {
  const dir = mkdtempSync(join(tmpdir(), "mx-cut-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("builds a 1080x1920 H.264/AAC cut with captions, end card and narration", async () => {
    const stills = ["#7a5c3e", "#2f4858", "#86bbd8"].map((c, i) => {
      const f = join(dir, `still_${i}.png`);
      execFileSync("magick", ["-size", "768x1365", `xc:${c}`, f]);
      return f;
    });
    const narration = join(dir, "vo.wav");
    execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "sine=frequency=220:duration=5.6", "-ar", "48000", narration]);
    const words: Word[] = [
      { w: "Stop", s: 0.1, e: 0.5, shot: 1 }, { w: "scrolling.", s: 0.5, e: 1.2, shot: 1 },
      { w: "It's", s: 1.9, e: 2.2, shot: 2 }, { w: "87%", s: 2.2, e: 2.8, shot: 2 }, { w: "done.", s: 2.8, e: 3.4, shot: 2 },
      { w: "Try", s: 4.6, e: 4.9, shot: 3 }, { w: "free.", s: 4.9, e: 5.6, shot: 3 },
    ];
    const times = shotTimes({ shots: [{ n: 1, t_target: [0, 2] }, { n: 2, t_target: [2, 4.5] }, { n: 3, t_target: [4.5, 7] }], endCard: true }, words);
    const out = join(dir, "cut.mp4");
    const last = times.at(-1);
    if (!last) throw new Error("times");
    const r = await buildCut({ dir, stills, times, captions: captionChunks(words), endCard: { text: "Try it free", start: last.start, end: last.end }, narration, look: { font: FONT }, out });
    const probe = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", out], { encoding: "utf8" })) as {
      streams: { codec_type: string; codec_name: string; width?: number; height?: number }[];
      format: { duration: string };
    };
    const v = probe.streams.find((s) => s.codec_type === "video");
    expect(v).toMatchObject({ codec_name: "h264", width: 1080, height: 1920 });
    expect(probe.streams.find((s) => s.codec_type === "audio")?.codec_name).toBe("aac");
    expect(Number(probe.format.duration)).toBeCloseTo(r.seconds, 0);
    // Regression (2026-11-06): the trailing blank caption frame was saved as 1-bit greyscale (no alpha)
    // and blacked out the picture after the last caption. The lower half must still show the still.
    const px = execFileSync("ffmpeg", ["-hide_banner", "-loglevel", "error", "-sseof", "-0.4", "-i", out, "-frames:v", "1", "-vf", "crop=200:200:440:1500,scale=1:1,format=gray", "-f", "rawvideo", "-"]);
    expect(px[0]).toBeGreaterThan(40);
  }, 120_000);
});
