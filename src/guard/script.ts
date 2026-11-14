import type { Script } from "../schema/script.js";
import { scriptLines } from "../schema/script.js";
import { checkClaims } from "./claims.js";
import { checkOriginality } from "./originality.js";
import { mentionsName } from "./overlap.js";
import { HOOK_MAX_WORDS } from "../hooks/limits.js";
import { WORDS_PER_SECOND, checkTiming, wordBudget } from "./timing.js";

/** A structure whose voice is captions/on-screen text only (e.g. "no VO; captions carry every line"). */
export function isCaptionsOnly(voice: string): boolean {
  return /\bno (vo|voice|voiceover)\b|captions?\s+(only|carry)|text only|on-screen text only/i.test(voice);
}

/**
 * Most words a hook line may have for this structure: 12 for on-screen hooks (captions-only
 * formats); for a spoken hook, what fits the hook window at 2.5 words/sec (+10%), capped at 12.
 */
export function hookWordLimit(s: { hook: { t: readonly number[] }; audio: { voice: string } }, wps = WORDS_PER_SECOND): number {
  if (isCaptionsOnly(s.audio.voice)) return HOOK_MAX_WORDS;
  const win = (s.hook.t[1] ?? 0) - (s.hook.t[0] ?? 0);
  return Math.min(HOOK_MAX_WORDS, wordBudget(win, wps).max);
}

export interface ScriptAudit {
  errors: string[];
  checks: Script["checks"];
}

type Auditable = Pick<Script, "brief" | "structure" | "hook" | "beats" | "cast" | "sets" | "audio"> & { checks?: { words_per_second?: number | undefined } | undefined };

/**
 * Every script rule except the schema: originality (lines, pictures, cast, sets) against the
 * source ad, no source brand, timing ±10%, claims from the brief. `press --finish` saves only
 * when this is clean; `render` re-runs it before any spend. The speaking rate is `wps`, else the
 * one the script was saved with (`checks.words_per_second`), else 2.5.
 */
export function auditScript(s: Auditable, sourceText: string, wps?: number): ScriptAudit {
  const rate = wps ?? s.checks?.words_per_second ?? WORDS_PER_SECOND;
  const lines = scriptLines(s);
  const pictures = [
    { path: "hook.visual", text: s.hook.visual },
    ...s.beats.map((b, i) => ({ path: `beats.${i}.visual`, text: b.visual })),
    ...Object.entries(s.cast).map(([n, d]) => ({ path: `cast.${n}`, text: d })),
    ...Object.entries(s.sets).map(([n, d]) => ({ path: `sets.${n}`, text: d })),
  ];
  const all = [...lines.map((l) => ({ path: l.path, text: l.text })), ...pictures];

  const originality = checkOriginality(all, sourceText);
  const brand = s.structure.source.kind === "meta" ? s.structure.source.page_name : "";
  const brandErrors = all.filter((l) => mentionsName(l.text, brand)).map((l) => `${l.path}: names the source brand`);
  const captionsOnly = isCaptionsOnly(s.audio.voice);
  const timing = checkTiming(
    // In a captions-only format the hook is on-screen text that holds into the next beat.
    lines.map((l) => ({ path: l.path, t: l.t, line: l.text, onScreen: captionsOnly && l.role === "hook" })),
    s.structure.duration_s,
    captionsOnly,
    rate,
  );
  const claims = checkClaims(lines, s.brief);

  return {
    errors: [...originality.errors, ...brandErrors, ...timing.errors, ...claims],
    checks: {
      overlap_passed: originality.errors.length === 0 && brandErrors.length === 0,
      max_overlap_words: originality.maxRun,
      timing_within_10pct: timing.errors.length === 0,
      claims_in_brief: claims.length === 0,
      words_per_second: rate,
    },
  };
}
