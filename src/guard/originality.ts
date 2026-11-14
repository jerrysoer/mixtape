import { longestSharedRun, nearCopy } from "./overlap.js";

/**
 * The originality guard (CLAUDE.md guardrail, PRD F4/F5): no line of our script may share
 * a run of MORE THAN 6 words with the source transcript or ad copy, and no line may be a
 * near-copy (a source line with a few words swapped; DECISIONS "Near-copy check").
 * `press --finish` refuses to save, and `render` refuses to run, when this fails.
 */
export const ORIGINALITY_MAX_RUN = 7; // blocked at 7+ shared words ("any run of more than 6")

export interface Line {
  path: string;
  text: string;
}

export interface OriginalityResult {
  errors: string[];
  /** Longest shared run found in any line (0 when none reached 1 word… or no source). */
  maxRun: number;
  /** Highest near-copy ratio found (0 when none reached the threshold). */
  maxNear: number;
}

export function checkOriginality(lines: Line[], sourceText: string): OriginalityResult {
  const errors: string[] = [];
  let maxRun = 0;
  let maxNear = 0;
  if (!sourceText.trim()) return { errors, maxRun, maxNear };
  for (const { path, text } of lines) {
    // Track the longest run for the report (min length 1), then apply the limit.
    const run = longestSharedRun(text, sourceText, 1);
    if (run && run.length > maxRun) maxRun = run.length;
    if (run && run.length >= ORIGINALITY_MAX_RUN) {
      errors.push(`${path}: shares ${run.length} words in a row with the source ad ("${run.run}"); rewrite it`);
      continue;
    }
    const near = nearCopy(text, sourceText);
    if (near) {
      maxNear = Math.max(maxNear, near.ratio);
      errors.push(`${path}: near-copy of a source line (${Math.round(near.ratio * 100)}% of its words in order); rewrite it`);
    }
  }
  return { errors, maxRun, maxNear };
}
