import { z } from "zod";
import { MixtapeError } from "../lib/io.js";
import { exec } from "./exec.js";

export interface MediaInfo {
  duration_s: number;
  width: number;
  height: number;
  hasAudio: boolean;
}

const probeSchema = z.object({
  format: z.object({ duration: z.coerce.number().optional() }).optional(),
  streams: z.array(
    z.object({
      codec_type: z.string(),
      width: z.number().optional(),
      height: z.number().optional(),
      duration: z.coerce.number().optional(),
    }),
  ),
});

export function parseProbe(json: string): MediaInfo {
  const p = probeSchema.parse(JSON.parse(json));
  const video = p.streams.find((s) => s.codec_type === "video");
  if (!video?.width || !video.height) throw new MixtapeError("No video stream found in the source file.");
  const duration = p.format?.duration ?? video.duration;
  if (!duration || !Number.isFinite(duration) || duration <= 0) throw new MixtapeError("Could not read the video's duration.");
  return {
    duration_s: Math.round(duration * 100) / 100,
    width: video.width,
    height: video.height,
    hasAudio: p.streams.some((s) => s.codec_type === "audio"),
  };
}

export async function probe(absPath: string): Promise<MediaInfo> {
  const { stdout } = await exec("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", absPath], { timeoutMs: 30_000 });
  return parseProbe(stdout);
}

/** Nearest standard aspect for the structure (9:16, 4:5, 1:1, 16:9). */
export function nearestAspect(width: number, height: number): "9:16" | "4:5" | "1:1" | "16:9" {
  const r = width / height;
  const options = [
    ["9:16", 9 / 16],
    ["4:5", 4 / 5],
    ["1:1", 1],
    ["16:9", 16 / 9],
  ] as const;
  let best: (typeof options)[number] = options[0];
  for (const o of options) if (Math.abs(Math.log(r / o[1])) < Math.abs(Math.log(r / best[1]))) best = o;
  return best[0];
}
