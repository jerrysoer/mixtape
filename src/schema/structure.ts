import { z } from "zod";

/**
 * structure.json — the reusable FORMAT of an ad (docs/Mixtape-PRD.md §4 "Contracts").
 * Roles and patterns only: no original lines, footage, audio or likeness.
 * Shared with AutoHook, so field names follow the PRD contract exactly.
 */

/** Hook patterns (PRD §4) + `before_after` (Commercial Break F4, DECISIONS 2026-11-06). */
export const HOOK_PATTERNS = [
  "contrarian_reveal",
  "stop_doing_x",
  "pov",
  "day_in_life",
  "number_shock",
  "sensory",
  "myth_bust",
  "announcement",
  "testimonial",
  "before_after",
] as const;
export type HookPattern = (typeof HOOK_PATTERNS)[number];

/**
 * Beat roles. Adapted from the key-moment taxonomy in XXXJackal/viral-video-analyzer (MIT)
 * plus the PRD's problem/demo/proof/cta and parody beats (setup, punchline).
 * The hook is not a beat: it lives in `hook`.
 */
export const BEAT_ROLES = [
  "setup",
  "problem",
  "agitate",
  "curiosity_gap",
  "solution",
  "demo",
  "proof",
  "social_proof",
  "authority",
  "before",
  "after",
  "comparison",
  "objection",
  "twist",
  "reveal",
  "punchline",
  "offer",
  "urgency",
  "cta",
] as const;
export type BeatRole = (typeof BEAT_ROLES)[number];

/** Format patterns seen so far (Extras §1 + Commercial Break F1–F14). Advisory: any snake_case slug is valid. */
export const KNOWN_FORMATS = [
  "demo_in_context",
  "founder_talking_head",
  "pov_relatable",
  "creator_routine",
  "comparison_static",
  "comparison_table",
  "asmr_unbox",
  "listicle",
  "launch",
  "before_after",
  "social_proof",
  "review_readaloud",
  "problem_agitate_solve",
  "haul",
  "value_justification",
  "street_interview",
  "podcast_clip",
  "subscription_unbox",
  "expert_reacts",
] as const;

export const ASPECTS = ["9:16", "4:5", "1:1", "16:9"] as const;

/** Seconds; tolerance used when checking that beats tile the timeline. */
export const TIME_TOLERANCE_S = 0.25;
export const MAX_DURATION_S = 180;

const slug = z
  .string()
  .regex(/^[a-z][a-z0-9_]{1,47}$/, "snake_case slug, 2-48 chars");

/** Short free-text description. Caps stop a transcript being smuggled in as a "description". */
const desc = (max: number) => z.string().trim().min(2).max(max);

const span = z
  .tuple([z.number().min(0).max(MAX_DURATION_S), z.number().min(0).max(MAX_DURATION_S)])
  .refine(([a, b]) => b > a, "end must be after start");

const metaSource = z
  .object({
    platform: z.literal("meta"),
    kind: z.literal("meta"),
    ad_id: z.string().regex(/^\d{5,25}$/),
    page_name: desc(120),
    days_running: z.number().int().min(0).max(10_000),
    variants: z.number().int().min(1).max(10_000),
    cache_id: z.string().regex(/^[a-z0-9-]{6,64}$/).optional(),
  })
  .strict();

const uploadSource = z
  .object({
    kind: z.literal("upload"),
    /** Basename only, never a full local path. */
    file_name: z.string().min(1).max(200).regex(/^[^/\\]+$/),
    cache_id: z.string().regex(/^[a-z0-9-]{6,64}$/).optional(),
  })
  .strict();

const linkSource = z
  .object({
    kind: z.literal("link"),
    /** Hostname only: signed media URLs carry tokens and expire. */
    host: z.string().min(1).max(253),
    cache_id: z.string().regex(/^[a-z0-9-]{6,64}$/).optional(),
  })
  .strict();

const describeSource = z
  .object({
    kind: z.literal("describe"),
    cache_id: z.string().regex(/^[a-z0-9-]{6,64}$/).optional(),
  })
  .strict();

/** Built-in format library (templates/formats/F*.structure.json). */
const templateSource = z
  .object({
    kind: z.literal("template"),
    id: z.string().regex(/^F\d{1,3}$/),
    name: desc(80),
  })
  .strict();

export const sourceSchema = z.discriminatedUnion("kind", [metaSource, uploadSource, linkSource, describeSource, templateSource]);
export type StructureSource = z.infer<typeof sourceSchema>;

export const hookSchema = z
  .object({
    t: span,
    pattern: z.enum(HOOK_PATTERNS),
    /** What the hook line DOES ("denies the obvious answer"), never what it says. */
    text_role: desc(140),
    visual: desc(200).optional(),
    candidates: z.array(z.string().max(200)).max(10),
  })
  .strict();

export const beatSchema = z
  .object({
    t: span,
    role: z.enum(BEAT_ROLES),
    /** Shot pattern ("close-up, relatable frustration"), never a description of a real person. */
    visual: desc(200),
    /** What the line in this beat does, e.g. "names the pain in one sentence". */
    line_role: desc(140).optional(),
    caption_style: desc(120).optional(),
  })
  .strict();
export type Beat = z.infer<typeof beatSchema>;

export const audioSchema = z
  .object({
    music: desc(120),
    sfx: z.array(desc(60)).max(12),
    voice: desc(80),
  })
  .strict();

export const RULES_TEXT = "roles and patterns only - no original lines, footage, audio or likeness";

export const structureSchema = z
  .object({
    source: sourceSchema,
    duration_s: z.number().positive().max(MAX_DURATION_S),
    aspect: z.enum(ASPECTS),
    format: slug,
    hook: hookSchema,
    beats: z.array(beatSchema).min(2).max(12),
    audio: audioSchema,
    rules: z.literal(RULES_TEXT),
  })
  .strict()
  .superRefine((s, ctx) => {
    for (const issue of timelineIssues(s)) ctx.addIssue({ code: "custom", message: issue.message, path: issue.path });
  });
export type Structure = z.infer<typeof structureSchema>;

interface TimelineIssue {
  message: string;
  path: (string | number)[];
}

/** Hook starts at 0; beats follow the hook with no gaps or overlaps; the last beat ends at duration_s. */
export function timelineIssues(s: { duration_s: number; hook: { t: readonly number[] }; beats: { t: readonly number[] }[] }): TimelineIssue[] {
  const issues: TimelineIssue[] = [];
  const near = (a: number | undefined, b: number | undefined) => a !== undefined && b !== undefined && Math.abs(a - b) <= TIME_TOLERANCE_S;
  if (!near(s.hook.t[0], 0)) issues.push({ message: "hook must start at 0", path: ["hook", "t", 0] });
  let prevEnd = s.hook.t[1];
  s.beats.forEach((b, i) => {
    if (!near(b.t[0], prevEnd)) {
      issues.push({ message: `beat ${i} starts at ${b.t[0]} but the previous part ends at ${prevEnd} (no gaps or overlaps)`, path: ["beats", i, "t", 0] });
    }
    prevEnd = b.t[1];
  });
  if (!near(prevEnd, s.duration_s)) {
    issues.push({ message: `last beat ends at ${prevEnd} but duration_s is ${s.duration_s}`, path: ["beats", s.beats.length - 1, "t", 1] });
  }
  return issues;
}

/** Every human-readable string Claude wrote into a structure (for the overlap and quote checks). */
export function describedText(s: Pick<Structure, "format" | "hook" | "beats" | "audio">): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = [
    { path: "hook.text_role", text: s.hook.text_role },
    { path: "audio.music", text: s.audio.music },
    { path: "audio.voice", text: s.audio.voice },
  ];
  if (s.hook.visual) out.push({ path: "hook.visual", text: s.hook.visual });
  s.hook.candidates.forEach((c, i) => out.push({ path: `hook.candidates.${i}`, text: c }));
  s.audio.sfx.forEach((x, i) => out.push({ path: `audio.sfx.${i}`, text: x }));
  s.beats.forEach((b, i) => {
    out.push({ path: `beats.${i}.visual`, text: b.visual });
    if (b.line_role) out.push({ path: `beats.${i}.line_role`, text: b.line_role });
    if (b.caption_style) out.push({ path: `beats.${i}.caption_style`, text: b.caption_style });
  });
  return out;
}

/** Readable one-line-per-issue rendering of a zod error (no values echoed). */
export function formatIssues(error: z.ZodError): string[] {
  return error.issues.map((i) => `${i.path.length ? i.path.join(".") : "(root)"}: ${i.message}`);
}
