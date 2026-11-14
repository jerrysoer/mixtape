import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { MixtapeError } from "../lib/io.js";
import { exec } from "../media/exec.js";
import type { Plan } from "./plan.js";
import type { ShotTime } from "./timeline.js";

/**
 * QC in skill mode: the CLI lays out the stills (or clip frames) from the cut; Claude Code looks and
 * answers per shot (frame QC: picture matches the line, no text/logos, no real-person likeness,
 * cast matches their sheet) and per person (anatomy: hands, fingers, limbs, faces). The motion
 * stage adds motion (the clip moves as its line says, nothing drifts from the still) and lips
 * (speaker's mouth matches the words; closed when nobody speaks).
 * Verdicts live in qc.json (stills) and qc-clips.json (clips) so a clip pass never unlocks a still.
 * Model routing: anatomy first pass on Opus (memory: QC model routing).
 */

const verdict = z.enum(["pass", "fail", "n/a"]);

export const qcAnswerSchema = z
  .object({
    shots: z.array(
      z
        .object({
          id: z.string().regex(/^(shot|clip)_\d{2}$/),
          frame: z.enum(["pass", "fail"]),
          anatomy: verdict,
          motion: verdict.default("n/a"),
          lips: verdict.default("n/a"),
          note: z.string().max(300).default(""),
        })
        .strict(),
    ),
  })
  .strict();
export type QcAnswer = z.infer<typeof qcAnswerSchema>;

export type QcStage = Plan["stage"];
const pad = (n: number) => String(n).padStart(2, "0");
export const qcFile = (dir: string, stage: QcStage): string => join(dir, stage === "clips" ? "qc-clips.json" : "qc.json");

async function frame(cut: string, at: number, file: string): Promise<void> {
  await exec("ffmpeg", ["-hide_banner", "-nostdin", "-loglevel", "error", "-y", "-ss", at.toFixed(2), "-i", cut, "-frames:v", "1", "-vf", "scale=540:-2", "-q:v", "4", file]);
}

async function montage(frames: string[], across: number, sheet: string): Promise<void> {
  const args = [...frames, "-tile", `${across}x`, "-geometry", "+6+6", "-background", "#808080", sheet];
  await exec("magick", ["montage", ...args]).catch(() => exec("montage", args));
}

export async function prepareQc(dir: string, plan: Plan, cut: string, times: ShotTime[], stills: Record<string, string>, clips: Record<string, string> = {}): Promise<string> {
  const qc = join(dir, "qc");
  mkdirSync(qc, { recursive: true });
  const motion = plan.stage === "clips";
  // Stills stage: one mid-shot frame per shot, 3 across. Clips stage: first, middle and last frame per clip, one row per shot.
  const frames: string[] = [];
  for (const t of times) {
    const at = motion ? [t.start + 0.1, (t.start + t.end) / 2, Math.max(t.start, t.end - 0.15)] : [(t.start + t.end) / 2];
    for (const [k, a] of at.entries()) {
      const f = join(qc, `cut_${pad(t.n)}${motion ? `_${["first", "mid", "last"][k]}` : ""}.jpg`);
      await frame(cut, a, f);
      frames.push(f);
    }
  }
  const sheet = join(qc, "cut_sheet.jpg");
  await montage(frames, 3, sheet);
  const sheets = plan.stills.filter((j) => j.kind === "sheet").map((j) => `  - ${j.id}: ${stills[j.id] ?? "(missing)"}`);

  const lines = plan.shots.map((s) => {
    const id = `shot_${pad(s.n)}`;
    const people = Object.entries(s.people).map(([n, a]) => `${n} (${a})`).join("; ") || "nobody";
    if (!motion) return `- **${id}** (${s.beat}) line: "${s.vo}"\n  - picture: ${s.prompt}\n  - people: ${people}\n  - still: ${stills[id] ?? "(missing)"}`;
    const cid = `clip_${pad(s.n)}`;
    const job = plan.clips.find((c) => c.id === cid);
    const clip = clips[cid];
    return `- **${cid}** (${s.beat}) line: "${s.vo}"\n  - picture: ${s.prompt}\n  - motion: ${job ? (s.motion ?? "(default: slow move)") : "none: this shot stays a still"}\n  - speaker: ${s.speaker ?? "nobody (mouths closed)"}\n  - people: ${people}\n  - still it started from: ${stills[id] ?? "(missing)"}\n  - clip: ${clip ?? "(none: fell back to the still)"}`;
  });

  const prompt = motion
    ? `# mixtape render QC (motion): ${plan.slug}

Look at the cut sheet (\`${sheet}\`: one row per shot, first / middle / last frame) and WATCH every clip listed below at full size (open the mp4; scrub it).
${sheets.length ? `Character sheets (what each person must look like):\n${sheets.join("\n")}\n` : ""}
For every clip answer:
- **frame**: pass only if all three frames still show what the line and picture say; no readable text, logos or watermarks; nobody who looks like a real person or celebrity; each person matches their sheet AND the still the clip started from (same face, hair, clothes, room).
- **anatomy**: for clips with people, pass only if hands (count fingers), limbs, joints and faces stay possible in every frame you look at; "n/a" when no person is visible. No bulk-ticking.
- **motion**: pass only if the movement matches the motion line, nothing morphs or pops in, the camera doesn't cut or switch, and the brightness doesn't jump from the still.
- **lips**: for a clip with a speaker, pass only if the mouth moves with speech and is closed in silences; for clips with no speaker, pass only if every mouth stays closed; "n/a" when no face is visible.
A clip that fails gets one retake (its own quote); if that fails too, the shot keeps its still.

${lines.join("\n")}

Write \`${join(qc, "answer.json")}\`:

\`\`\`json
{ "shots": [ { "id": "clip_01", "frame": "pass", "anatomy": "n/a", "motion": "pass", "lips": "n/a", "note": "" } ] }
\`\`\`

then run the --qc-finish command printed by render.
`
    : `# mixtape render QC: ${plan.slug}

Look at the cut (\`${sheet}\`, one frame per shot, left to right, top to bottom) and open each full-size still listed below.
${sheets.length ? `Character sheets (what each person must look like):\n${sheets.join("\n")}\n` : ""}
For every shot answer:
- **frame**: pass only if the picture shows what the line and picture say; no readable text, logos or watermarks; nobody who looks like a real person or celebrity; each person matches their sheet.
- **anatomy**: for shots with people, pass only if hands (count fingers at full size), limbs, joints and faces are possible and comfortable; "n/a" when no person is visible. No bulk-ticking: look at each.

${lines.join("\n")}

Write \`${join(qc, "answer.json")}\`:

\`\`\`json
{ "shots": [ { "id": "shot_01", "frame": "pass", "anatomy": "n/a", "note": "" } ] }
\`\`\`

then run the --qc-finish command printed by render.
`;
  const file = join(qc, "prompt.md");
  writeFileSync(file, prompt);
  return file;
}

/** Recorded verdicts by id for a stage: "pass" (frame pass, nothing else failed) or "fail". Passed items are locked. */
export function qcVerdicts(dir: string, stage: QcStage = "stills"): Map<string, "pass" | "fail"> {
  const file = qcFile(dir, stage);
  const verdicts = new Map<string, "pass" | "fail">();
  if (!existsSync(file)) return verdicts;
  const q = JSON.parse(readFileSync(file, "utf8")) as { verdicts?: { id: string; frame: string; anatomy: string; motion?: string; lips?: string }[] };
  for (const v of q.verdicts ?? []) verdicts.set(v.id, v.frame === "pass" && v.anatomy !== "fail" && v.motion !== "fail" && v.lips !== "fail" ? "pass" : "fail");
  return verdicts;
}

/** Drop one id's verdict (its item was retired for a retake; the new one is judged afresh). */
export function consumeVerdict(dir: string, stage: QcStage, id: string): void {
  const file = qcFile(dir, stage);
  if (!existsSync(file)) return;
  const q = JSON.parse(readFileSync(file, "utf8")) as { verdicts?: { id: string }[]; failures?: string[]; passed?: boolean };
  q.verdicts = (q.verdicts ?? []).filter((v) => v.id !== id);
  q.failures = (q.failures ?? []).filter((f) => !f.startsWith(`${id}:`));
  writeFileSync(file, JSON.stringify(q, null, 2) + "\n");
}

export interface QcResult {
  passed: boolean;
  failures: string[];
  stage: QcStage;
}

export function finishQc(dir: string, plan: Plan): QcResult {
  const file = join(dir, "qc", "answer.json");
  if (!existsSync(file)) throw new MixtapeError(`No QC answer at ${file}. Answer qc/prompt.md first.`);
  if (statSync(file).size > 64 * 1024) throw new MixtapeError("QC answer is too large.");
  const r = qcAnswerSchema.safeParse(JSON.parse(readFileSync(file, "utf8")));
  if (!r.success) throw new MixtapeError(`QC answer is invalid: ${r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  const stage: QcStage = plan.stage === "clips" ? "clips" : "stills";
  // Clips stage: only shots that got a clip need a verdict; still-only shots were passed as stills.
  const want = stage === "clips" ? plan.clips.map((c) => c.id) : plan.shots.map((s) => `shot_${pad(s.n)}`);
  const got = new Map(r.data.shots.map((s) => [s.id, s]));
  if (stage === "clips" && r.data.shots.some((s) => s.id.startsWith("shot_"))) throw new MixtapeError("This render is at the clip stage: answer per clip_NN (see qc/prompt.md), not per still.");
  // An item without a verdict is not delivered (it may not exist yet); the others are recorded.
  const failures = want.flatMap((id) => {
    const s = got.get(id);
    if (!s) return [`${id}: no verdict yet`];
    const bad = (["frame", "anatomy", "motion", "lips"] as const).filter((k) => s[k] === "fail");
    return bad.length ? [`${id}: ${bad.join(" + ")} fail${s.note ? ` (${s.note})` : ""}`] : [];
  });
  const result = { stage, passed: failures.length === 0, failures, verdicts: r.data.shots, at: new Date().toISOString() };
  writeFileSync(qcFile(dir, stage), JSON.stringify(result, null, 2) + "\n");
  return { passed: result.passed, failures, stage };
}
