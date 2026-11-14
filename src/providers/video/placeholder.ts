import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { exec } from "../../media/exec.js";
import type { ClipJob } from "../../render/plan.js";

/**
 * Free stand-in for Seedance (MX_VIDEO_SOURCE=placeholder): a 720x1280 ffmpeg push-in on each
 * locked still, the length Seedance would have made. Lets the whole motion stage run end to end
 * (quote → approve → run → QC) without credits.
 */
export async function placeholderClips(jobs: ClipJob[], stills: Record<string, string>, dir: string): Promise<Record<string, string>> {
  const outDir = join(dir, "clips");
  mkdirSync(outDir, { recursive: true });
  const files: Record<string, string> = {};
  for (const j of jobs) {
    const still = stills[j.still];
    if (!still) continue;
    const file = join(outDir, `${j.id}.mp4`);
    const frames = j.seconds * 24;
    const vf = `scale=1440:2560:force_original_aspect_ratio=increase,crop=1440:2560,zoompan=z='1+0.06*on/${frames}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=720x1280:fps=24,format=yuv420p`;
    await exec("ffmpeg", ["-hide_banner", "-nostdin", "-loglevel", "error", "-y", "-i", still, "-vf", vf, "-frames:v", String(frames), "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", file], { timeoutMs: 300_000 });
    files[j.id] = file;
  }
  return files;
}
