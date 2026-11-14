import { createHash } from "node:crypto";
import { isCaptionsOnly } from "../guard/script.js";
import type { Script, Shot } from "../schema/script.js";

/**
 * Render plan: script.json → shot list (EXPORT-CONTRACT mapping) + the stills to generate.
 * Same build order as /2minvid (read for patterns only): a character sheet per cast member,
 * a set plate for every set used by 2+ shots, then one still per shot with those attached.
 */

export interface PlanShot {
  n: number;
  beat: string;
  vo: string;
  t_target: [number, number];
  set: string;
  chars: string[];
  time: string;
  camera: string;
  people: Record<string, string>;
  extras: string;
  wear: Record<string, string>;
  state?: string;
  /** Clip motion (script `shot.motion`); the clip planner derives one from the camera when absent. */
  motion?: string;
  /** Who speaks this line on camera in the clip; absent = voice over action. */
  speaker?: string;
  prompt: string;
  end_card: boolean;
}

export interface StillJob {
  id: string;
  kind: "sheet" | "plate" | "shot";
  prompt: string;
  /** Ids of earlier stills attached as references. */
  refs: string[];
  /** sha1 of exactly what would be generated (kind, prompt, refs): a changed hash = a new still. */
  hash: string;
}

export function stillHash(j: Pick<StillJob, "kind" | "prompt" | "refs">): string {
  return createHash("sha1").update(JSON.stringify([j.kind, j.prompt, j.refs])).digest("hex").slice(0, 16);
}

/**
 * Seedream copies the camera of an attached image, so a close-up given the wide set plate came
 * out as the empty room (Plateful shot_04, 2026-11-06). Close-ups get no plate.
 */
export function isCloseUp(camera: string): boolean {
  return /^(extreme\s+)?close\b|close-up|closeup|macro|insert|detail/i.test(camera.trim());
}

export interface Plan {
  slug: string;
  aspect: string;
  /** The cut's length: the structure's target until the narration is recorded, then the read (`read_s`). */
  duration_s: number;
  /** The structure's target length (script.structure.duration_s), kept for the comparison. */
  target_s: number;
  /** Length of the recorded read (last shot's end, tail included) once the narration is on file; the shots' windows then follow it. */
  read_s?: number;
  style: string;
  shots: PlanShot[];
  stills: StillJob[];
  /** `tag`: the v4 delivery tag in front of the take (script `audio.delivery_tag`, else the account's). */
  voice: { mode: "narrator" | "none"; text: string; chars: number; tag?: string };
  /** Render mode (config MX_RENDER_MODE or --still) and the stage this plan quotes: stills first, clips once every shot is QC-locked. */
  mode: "motion" | "still";
  /** "voice": stills are locked but the narration for this mode's voice model isn't on file yet (e.g. a v3 render remade in motion). */
  stage: "stills" | "voice" | "clips";
  /** Clip jobs (stage "clips" only; see motion.ts). */
  clips: ClipJob[];
}

/** One Seedance clip built on a QC-locked still (motion.ts fills these in). */
export interface ClipJob {
  id: string;
  /** The still it starts from (shot_NN). */
  still: string;
  shot: number;
  seconds: number;
  model: string;
  prompt: string;
  speaker: string | null;
  /** Tight audio ref (the speaker's line) the clip lip-syncs to; absent = no lips. */
  audio?: string;
  /** sha1 of exactly what would be generated: still hash, prompt, seconds, model, speaker, audio. */
  hash: string;
  /** The same without seconds: an on-file clip with this base and enough length is reused (a narration rewrite shifts windows). */
  base: string;
}

type Part = { visual: string; shot: Shot };

/**
 * Every still: no text, and nothing that borrows someone else's IP or face (ep 1's plate drew hero
 * lookalikes on posters). Loosened 2026-11-07 at Jerry's request: invented era-style art is fine.
 */
const NO_TEXT = "No text, no logos, no watermarks. No real people, celebrities, brands or existing characters. Posters, screens and packaging may show invented era-style art: made-up bands, original cartoon characters, fake movie art, with no readable words.";

function sentence(s: string): string {
  const t = s.trim().replace(/[.\s]+$/, "");
  return t ? `${t.charAt(0).toUpperCase()}${t.slice(1)}.` : "";
}

function outfit(s: Pick<Script, "wardrobe">, name: string, key: string): string {
  return s.wardrobe[name]?.[key] ?? "";
}

/** One shot still: style, set, light, camera, the picture, each person (identity + outfit + action), state. */
export function shotPrompt(s: Pick<Script, "style_lock" | "sets" | "cast" | "wardrobe">, part: Part, endCard = false, plate: string | null = null): string {
  const sh = part.shot;
  const people = Object.entries(sh.people).map(([name, action]) => {
    const look = [s.cast[name], outfit(s, name, sh.wear[name] ?? "default")].filter(Boolean);
    return sentence(`${name}: ${look[0] ?? ""}${look[1] ? `, wearing ${look[1]}` : ""}; ${action}`);
  });
  return [
    sentence(s.style_lock.style_prompt),
    sentence(s.sets[sh.set] ?? ""),
    sentence(`${sh.time} light`),
    sentence(`Camera: ${sh.camera}`),
    sentence(part.visual),
    ...people,
    sh.extras && sh.extras.toLowerCase() !== "none" ? sentence(`Background: ${sh.extras}`) : "No other people.",
    sh.state ? sentence(`Must hold: ${sh.state}`) : "",
    // "Leave empty space" was drawn as a solid black band (ep 5, 2026-11-07): ask for a calm top third instead.
    endCard ? "The picture fills the whole frame; keep the top third calm and uncluttered (plain wall, ceiling or sky) for an offer card." : "",
    plate ? `The ${plate} reference shows the room only: keep its layout and furniture; take the light, time of day, framing and props from this description.` : "",
    NO_TEXT,
  ]
    .filter(Boolean)
    .join(" ");
}

export function sheetPrompt(s: Pick<Script, "style_lock" | "cast" | "wardrobe">, name: string): string {
  const looks = s.wardrobe[name] ?? {};
  const wear = looks["default"] ?? Object.values(looks)[0] ?? "";
  return [
    sentence(s.style_lock.style_prompt),
    sentence(`Character sheet of one invented person: ${s.cast[name] ?? name}${wear ? `, wearing ${wear}` : ""}`),
    "Front, three-quarter and side views, full body, neutral expression, plain light background.",
    NO_TEXT,
  ].join(" ");
}

export function platePrompt(s: Pick<Script, "style_lock" | "sets">, set: string): string {
  return [sentence(s.style_lock.style_prompt), sentence(s.sets[set] ?? set), "No people. Eye-level establishing view.", NO_TEXT].join(" ");
}

export function buildPlan(s: Script, slug: string, mode: Plan["mode"] = "still"): Plan {
  const parts: { beat: string; line: string; t: [number, number]; part: Part }[] = [
    { beat: "HOOK", line: s.hook.line, t: s.hook.t, part: s.hook },
    ...s.beats.map((b) => ({ beat: b.role.toUpperCase(), line: b.line, t: b.t, part: b })),
  ];
  const last = parts.length - 1;

  const shots: PlanShot[] = parts.map((p, i) => {
    const sh = p.part.shot;
    const shot: PlanShot = {
      n: i + 1,
      beat: p.beat,
      vo: p.line,
      t_target: p.t,
      set: sh.set,
      chars: Object.keys(sh.people),
      time: sh.time,
      camera: sh.camera,
      people: sh.people,
      extras: sh.extras,
      wear: sh.wear,
      prompt: p.part.visual,
      end_card: i === last && p.beat === "CTA",
    };
    if (sh.state) shot.state = sh.state;
    if (sh.motion) shot.motion = sh.motion;
    if (sh.speaker) shot.speaker = sh.speaker;
    return shot;
  });

  const setUse = new Map<string, number>();
  // A plate is worth making only for sets seen in 2+ shots that can use it (close-ups never do).
  for (const sh of shots) if (!isCloseUp(sh.camera)) setUse.set(sh.set, (setUse.get(sh.set) ?? 0) + 1);
  const plated = new Set([...setUse].filter(([, n]) => n >= 2).map(([k]) => k));

  const stills: StillJob[] = [
    ...Object.keys(s.cast).map((name) => ({ id: `sheet_${name}`, kind: "sheet" as const, prompt: sheetPrompt(s, name), refs: [] as string[] })),
    ...[...plated].map((set) => ({ id: `plate_${set}`, kind: "plate" as const, prompt: platePrompt(s, set), refs: [] as string[] })),
    ...shots.map((sh, i) => {
      const part = parts[i]?.part ?? s.hook;
      const plate = plated.has(sh.set) && !isCloseUp(sh.camera) ? `plate_${sh.set}` : null;
      return {
        id: `shot_${String(sh.n).padStart(2, "0")}`,
        kind: "shot" as const,
        prompt: shotPrompt(s, part, sh.end_card, plate),
        refs: [...sh.chars.map((c) => `sheet_${c}`), ...(plate ? [plate] : [])],
      };
    }),
  ].map((j) => ({ ...j, hash: stillHash(j) }));

  const text = isCaptionsOnly(s.audio.voice) ? "" : parts.map((p) => p.line.trim()).join(" ");
  return {
    slug,
    aspect: s.structure.aspect,
    duration_s: s.structure.duration_s,
    target_s: s.structure.duration_s,
    style: s.style_lock.style_prompt,
    shots,
    stills,
    voice: text ? { mode: "narrator", text, chars: text.length } : { mode: "none", text: "", chars: 0 },
    mode,
    stage: "stills",
    clips: [],
  };
}
