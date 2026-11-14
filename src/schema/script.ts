import { z } from "zod";
import { ASPECTS, BEAT_ROLES, HOOK_PATTERNS, MAX_DURATION_S, sourceSchema, timelineIssues } from "./structure.js";

/**
 * script.json — our original ad, pressed from a structure and a brief (PRD §4, EXPORT-CONTRACT).
 * Shot slots mirror the render shot list (vo.json, prompt schema 2) so render is a mapping:
 * top-level `cast` (identity only), `wardrobe`, `sets`; per shot `set`, `time`, `camera`,
 * `people` (NAME → action), `extras`, `wear` (NAME → wardrobe key), `state`.
 */

const NAME = /^[A-Z][A-Z0-9_]{1,23}$/;
const name = z.string().regex(NAME, "UPPER_SNAKE name, 2-24 chars");
const text = (max: number) => z.string().trim().min(1).max(max);

const span = z.tuple([z.number().min(0).max(MAX_DURATION_S), z.number().min(0).max(MAX_DURATION_S)]).refine(([a, b]) => b > a, "end must be after start");

export const shotSchema = z
  .object({
    set: name,
    /** Time of day / light: "night", "early morning". */
    time: text(40),
    /** Framing and angle: "close, eye level". */
    camera: text(80),
    /** NAME → what they're doing in this shot (pose, action, expression). Empty for no people. */
    people: z.record(name, text(160)),
    /** Background people, or "none". */
    extras: text(120),
    /** NAME → wardrobe key in `wardrobe[NAME]`. Same names as `people`. */
    wear: z.record(name, z.string().regex(/^[a-z][a-z0-9_]{0,23}$/)),
    /** Prop and set state that must hold: "fridge door OPEN". */
    state: text(160).optional(),
    /** Motion for the clip (render default): one camera move + one action, e.g. "slow push in; she lifts the CD to the lens". */
    motion: text(120).optional(),
    /** Who says this line on camera (must be in `people`). Absent = the voice plays over the action, nobody speaks. */
    speaker: name.optional(),
  })
  .strict();
export type Shot = z.infer<typeof shotSchema>;

export const scriptBeatSchema = z
  .object({
    t: span,
    role: z.enum(BEAT_ROLES),
    /** The spoken / caption line. */
    line: text(300),
    /** One-sentence picture for the image model. */
    visual: text(300),
    shot: shotSchema,
  })
  .strict();

export const scriptHookSchema = z
  .object({
    t: span,
    pattern: z.enum(HOOK_PATTERNS),
    line: text(160),
    visual: text(300),
    shot: shotSchema,
  })
  .strict();

export const checksSchema = z
  .object({
    overlap_passed: z.boolean(),
    /** Longest run of words shared with the source (0 when there is no source text). */
    max_overlap_words: z.number().int().min(0),
    timing_within_10pct: z.boolean(),
    claims_in_brief: z.boolean(),
    /** Speaking rate the timing check used (words/s); absent = 2.5 (scripts from before 2026-11-07). */
    words_per_second: z.number().min(1).max(5).optional(),
  })
  .strict();

export const scriptSchema = z
  .object({
    brief: text(2000),
    /** Where the format came from. Keeps `source.cache_id` so render can re-run the originality guard. */
    structure: z
      .object({
        ref: text(120),
        format: z.string().regex(/^[a-z][a-z0-9_]{1,47}$/),
        source: sourceSchema,
        duration_s: z.number().positive().max(MAX_DURATION_S),
        aspect: z.enum(ASPECTS),
      })
      .strict(),
    hook: scriptHookSchema,
    hook_candidates: z.array(z.object({ text: text(200), score: z.number().nullable() }).strict()).max(10),
    beats: z.array(scriptBeatSchema).min(2).max(12),
    cast: z.record(name, text(240)),
    wardrobe: z.record(name, z.record(z.string().regex(/^[a-z][a-z0-9_]{0,23}$/), text(200))),
    /** SET → "INTERIOR ONLY: …" or "EXTERIOR ONLY: …" (one space, ceiling/sky + light). */
    sets: z.record(name, z.string().regex(/^(INTERIOR|EXTERIOR) ONLY: \S/, 'starts "INTERIOR ONLY: " or "EXTERIOR ONLY: "').max(300)),
    style_lock: z.object({ style_prompt: text(400), reference_image: z.string().max(500).nullable() }).strict(),
    audio: z
      .object({
        music: text(120),
        sfx: z.array(text(60)).max(12),
        voice: text(80),
        /** Imperfection layer applied to the lines at press time (src/render/imperfect.ts); absent = clean read. */
        imperfect: z.object({ rate: z.number().min(0).max(0.3), seed: z.number().int().min(0) }).strict().optional(),
        /** Narration register the monologue was written in (docs/NARRATION-BANK.md id); absent = none named. */
        register: z.string().regex(/^[a-z][a-z0-9_]{1,40}$/).optional(),
        /** ElevenLabs v4 delivery tag put in front of the take; overrides the account's. */
        delivery_tag: z.string().regex(/^\[[^\]]{2,80}\]$/).optional(),
      })
      .strict(),
    checks: checksSchema,
  })
  .strict()
  .superRefine((s, ctx) => {
    for (const i of timelineIssues({ duration_s: s.structure.duration_s, hook: s.hook, beats: s.beats })) ctx.addIssue({ code: "custom", message: i.message, path: i.path });
    for (const i of castIssues(s)) ctx.addIssue({ code: "custom", message: i.message, path: i.path });
  });
export type Script = z.infer<typeof scriptSchema>;

interface Issue {
  message: string;
  path: (string | number)[];
}

/** Every shot's set, people and wardrobe keys must resolve; cast and sets must be used. */
export function castIssues(s: Pick<Script, "hook" | "beats" | "cast" | "wardrobe" | "sets">): Issue[] {
  const issues: Issue[] = [];
  const shots: { shot: Shot; path: (string | number)[] }[] = [{ shot: s.hook.shot, path: ["hook", "shot"] }, ...s.beats.map((b, i) => ({ shot: b.shot, path: ["beats", i, "shot"] }))];
  const usedCast = new Set<string>();
  const usedSets = new Set<string>();
  for (const { shot, path } of shots) {
    usedSets.add(shot.set);
    if (!(shot.set in s.sets)) issues.push({ message: `set ${shot.set} is not in sets`, path: [...path, "set"] });
    const people = Object.keys(shot.people);
    const wear = Object.keys(shot.wear);
    for (const n of people) {
      usedCast.add(n);
      if (!(n in s.cast)) issues.push({ message: `${n} is not in cast`, path: [...path, "people", n] });
      const key = shot.wear[n];
      if (!key) issues.push({ message: `${n} has no wear entry`, path: [...path, "wear"] });
      else if (!s.wardrobe[n]?.[key]) issues.push({ message: `wardrobe ${n}.${key} is not defined`, path: [...path, "wear", n] });
    }
    for (const n of wear) if (!people.includes(n)) issues.push({ message: `wear lists ${n}, who is not in this shot`, path: [...path, "wear", n] });
    if (shot.speaker && !people.includes(shot.speaker)) issues.push({ message: `speaker ${shot.speaker} is not in this shot's people`, path: [...path, "speaker"] });
  }
  for (const n of Object.keys(s.cast)) if (!usedCast.has(n)) issues.push({ message: `cast ${n} is never in a shot`, path: ["cast", n] });
  for (const n of Object.keys(s.sets)) if (!usedSets.has(n)) issues.push({ message: `set ${n} is never used`, path: ["sets", n] });
  return issues;
}

/** Every line that will be spoken or shown, with a path, for the guards. */
export function scriptLines(s: Pick<Script, "hook" | "beats">): { path: string; role: Script["beats"][number]["role"] | "hook"; text: string; t: readonly number[] }[] {
  return [{ path: "hook.line", role: "hook" as const, text: s.hook.line, t: s.hook.t }, ...s.beats.map((b, i) => ({ path: `beats.${i}.line`, role: b.role, text: b.line, t: b.t }))];
}
