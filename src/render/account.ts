import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { MixtapeError } from "../lib/io.js";

/**
 * renders/account.json: the account-wide render choices (narrator, default look, captions).
 * Committed (the only tracked file under renders/); open-source users write their own.
 */
const accountSchema = z
  .object({
    narrator: z
      .object({
        provider: z.literal("elevenlabs"),
        /** Narrator model for `--still` renders. */
        model: z.string().min(1).default("eleven_v3"),
        /** Narrator model for motion renders (the default mode): v4 or later. */
        model_motion: z.string().min(1).default("eleven_v4"),
        voice_id: z.string().regex(/^[A-Za-z0-9]{10,40}$/),
        /** Measured speaking rate per model (words/s); unknown models use 2.5. v4 casual talk: 2.2 (ep 7, 2026-11-07). */
        words_per_second: z.record(z.string(), z.number().min(1).max(5)).default({}),
        /** ElevenLabs voice_settings sent with every take (the ep 7 takes Jerry picked: stability 0.35, similarity 0.8). */
        voice_settings: z.object({ stability: z.number().min(0).max(1), similarity_boost: z.number().min(0).max(1) }).optional(),
        /** Delivery tag put in front of the take for v4 ("[casual, amused]"); never spoken, stripped from captions. */
        delivery_tag: z.string().regex(/^\[[^\]]{2,80}\]$/).optional(),
        name: z.string().optional(),
        why: z.string().optional(),
      })
      .optional(),
    /** Used by press when no --style is given. */
    style_default: z.string().min(3).max(400).optional(),
    captions: z
      .object({
        font: z.string().min(1).default("/System/Library/Fonts/Supplemental/DIN Condensed Bold.ttf"),
        words_per_chunk: z.number().int().min(1).max(6).default(3),
      })
      .default({ font: "/System/Library/Fonts/Supplemental/DIN Condensed Bold.ttf", words_per_chunk: 3 }),
  })
  .passthrough();
export type Account = z.infer<typeof accountSchema>;

export function loadAccount(root: string): Account {
  const file = join(root, "renders", "account.json");
  if (!existsSync(file)) return accountSchema.parse({});
  const r = accountSchema.safeParse(JSON.parse(readFileSync(file, "utf8")));
  if (!r.success) throw new MixtapeError(`renders/account.json is invalid: ${r.error.issues.map((i) => i.path.join(".")).join(", ")}`);
  return r.data;
}

/** The narrator model for a mode: the motion model for motion renders, the still model for `--still`. */
export function narratorModel(account: Account, mode: "motion" | "still"): string {
  const n = account.narrator;
  if (!n) return "";
  return mode === "motion" ? n.model_motion : n.model;
}

/** The speaking rate (words/s) the narrator reads at in a mode; 2.5 when unmeasured. */
export function narratorRate(account: Account, mode: "motion" | "still"): number {
  return account.narrator?.words_per_second[narratorModel(account, mode)] ?? 2.5;
}
