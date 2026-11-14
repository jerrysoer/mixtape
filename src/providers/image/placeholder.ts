import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { exec } from "../../media/exec.js";
import type { StillJob } from "../../render/plan.js";

/** Free stand-in stills (MX_IMAGE_SOURCE=placeholder): a flat colour per job, for dry end-to-end runs. */
export async function placeholderStills(jobs: StillJob[], dir: string): Promise<Record<string, string>> {
  const stills = join(dir, "stills");
  mkdirSync(stills, { recursive: true });
  const files: Record<string, string> = {};
  for (const j of jobs) {
    const h = createHash("sha1").update(j.id).digest("hex");
    const color = `#${h.slice(0, 6)}`;
    const file = join(stills, `${j.id}.png`);
    await exec("magick", ["-size", "1152x2048", `xc:${color}`, "-fill", "rgba(250,247,240,0.35)", "-draw", "rectangle 96,864 1056,1184", file], { timeoutMs: 15_000 });
    files[j.id] = file;
  }
  return files;
}
