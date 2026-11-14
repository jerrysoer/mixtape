import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { MixtapeError } from "./lib/io.js";

/** Keys whose values must never be printed, logged or written to disk by Mixtape. */
export const SECRET_KEYS = ["ANTHROPIC_API_KEY", "ELEVENLABS_API_KEY", "SEARCHAPI_KEY", "APIFY_TOKEN", "META_ACCESS_TOKEN", "SUPABASE_SERVICE_ROLE_KEY"] as const;
export type SecretKey = (typeof SECRET_KEYS)[number];

const optionalSecret = z
  .string()
  .trim()
  .transform((v) => (v === "" ? undefined : v))
  .optional();

const configSchema = z.object({
  MX_DATA_SOURCE: z.enum(["searchapi", "apify", "meta"]).default("searchapi"),
  /** placeholder = free flat-colour stills for dry end-to-end runs. */
  MX_IMAGE_SOURCE: z.enum(["dreamina", "placeholder"]).default("dreamina"),
  /** Path to the dreamina-canvas CLI (default: on PATH). */
  MX_DREAMINA_BIN: optionalSecret,
  /** Seconds between Dreamina status checks while stills generate. */
  MX_POLL_SECONDS: z.coerce.number().int().min(0).max(900).default(20),
  /** How long one --run waits for Dreamina before handing back (a rerun resumes; nothing is billed twice). */
  MX_WAIT_TIMEOUT_SECONDS: z.coerce.number().int().min(1).max(86_400).default(1800),
  MX_VOICE_SOURCE: z.enum(["elevenlabs", "say"]).default("elevenlabs"),
  /** motion = Seedance clips on top of QC-locked stills (default); still = stills + Ken Burns only (`--still`). */
  MX_RENDER_MODE: z.enum(["motion", "still"]).default("motion"),
  /** placeholder = free ffmpeg moves on the stills, for dry end-to-end runs. */
  MX_VIDEO_SOURCE: z.enum(["dreamina", "placeholder"]).default("dreamina"),
  MX_VIDEO_MODEL: z.string().regex(/^[a-z0-9_.-]{2,40}$/).default("seedance_2.5"),
  /** Optional cheaper model for shots with nobody speaking (e.g. seedance_2.0_mini). Unset = MX_VIDEO_MODEL everywhere. */
  MX_VIDEO_MODEL_SILENT: optionalSecret,
  MX_VIDEO_RESOLUTION: z.enum(["480p", "720p"]).default("720p"),
  /** Quote estimate: Seedance 2.5 720p ≈ 18 cr per second (live 2026-10-27). The server quote still rules. */
  MX_CREDITS_PER_VIDEO_SEC: z.coerce.number().int().positive().max(1000).default(18),
  MX_MAX_SPEND_PER_RUN: z.coerce.number().positive().max(100).default(10),
  /** Quote estimate rates (render). Dreamina Seedream 5.0 pro 2K still ≈ 12 cr; Jerry's rate $1 = 113 cr (2026-10-17). */
  MX_CREDITS_PER_STILL: z.coerce.number().int().positive().max(1000).default(12),
  MX_CREDITS_PER_USD: z.coerce.number().positive().max(10_000).default(113),
  /** ElevenLabs narration estimate, USD per 1,000 characters. */
  MX_VOICE_USD_PER_1K_CHARS: z.coerce.number().min(0).max(10).default(0.15),
  /** auto = whisper-cpp (whisper-cli) if installed, else faster-whisper, else no transcript. */
  MX_TRANSCRIBER: z.enum(["auto", "whisper-cpp", "faster-whisper", "none"]).default("auto"),
  /** whisper-cpp: path to a ggml .bin; faster-whisper: a model name. Default per engine. */
  MX_WHISPER_MODEL: optionalSecret,
  MX_WHISPER_LANGUAGE: z.string().regex(/^(auto|[a-z]{2})$/).default("en"),
  MX_PYTHON: z.string().trim().min(1).default("python3"),
  AUTOHOOK_PATH: optionalSecret,
  ANTHROPIC_API_KEY: optionalSecret,
  ELEVENLABS_API_KEY: optionalSecret,
  SEARCHAPI_KEY: optionalSecret,
  APIFY_TOKEN: optionalSecret,
  META_ACCESS_TOKEN: optionalSecret,
  /** Optional: spy also writes mx_brands / mx_ads. Both unset → files only. */
  NEXT_PUBLIC_SUPABASE_URL: optionalSecret,
  SUPABASE_SERVICE_ROLE_KEY: optionalSecret,
});

export type Config = z.infer<typeof configSchema>;

/**
 * Load `.env.local` from `cwd` (if present) into a copy of the environment, then validate.
 * Real environment variables win over the file. `.env` is deliberately not read.
 */
export function loadConfig(cwd: string = process.cwd(), env: NodeJS.ProcessEnv = process.env): Config {
  const merged: NodeJS.ProcessEnv = { ...parseEnvFile(join(cwd, ".env.local")), ...env };
  const picked = Object.fromEntries(Object.keys(configSchema.shape).map((k) => [k, merged[k]]));
  const result = configSchema.safeParse(picked);
  if (!result.success) {
    // Name the bad keys, never echo their values.
    const keys = [...new Set(result.error.issues.map((i) => String(i.path[0])))].join(", ");
    throw new MixtapeError(`Invalid setting in .env.local or the environment: ${keys}. See .env.example.`);
  }
  return result.data;
}

/** Minimal KEY=value parser; ignores comments and blank lines, strips matching quotes. */
export function parseEnvFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const vars: Record<string, string> = {};
  const text = readFileSync(path, "utf8");
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim().replace(/^export\s+/, "");
    let value = line.slice(eq + 1).trim();
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
    vars[key] = value;
  }
  return vars;
}

/** "set" / "missing" view of the secrets, safe to print. */
export function secretStatus(config: Config): Record<SecretKey, "set" | "missing"> {
  return Object.fromEntries(SECRET_KEYS.map((k) => [k, config[k] ? "set" : "missing"])) as Record<SecretKey, "set" | "missing">;
}
