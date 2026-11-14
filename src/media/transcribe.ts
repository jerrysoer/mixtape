import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { Config } from "../config.js";
import { MixtapeError } from "../lib/io.js";
import { exec } from "./exec.js";

/**
 * Transcripts stay in .cache/ only. They feed the break prompt (as untrusted data)
 * and the originality guard; they are never copied into structure.json or outputs.
 */
export interface Transcript {
  engine: "whisper-cpp" | "faster-whisper" | "supplied" | "none";
  segments: { t: [number, number]; text: string }[];
  text: string;
}

export const EMPTY_TRANSCRIPT: Transcript = { engine: "none", segments: [], text: "" };

const DEFAULT_GGML = join(homedir(), ".local/share/whisper-models/ggml-base.en.bin");
const PY_SCRIPT = fileURLToPath(new URL("../../python/transcribe.py", import.meta.url));

const whisperCppSchema = z.object({
  transcription: z.array(z.object({ offsets: z.object({ from: z.number(), to: z.number() }), text: z.string() })),
});

export function parseWhisperCpp(json: string): Transcript {
  const p = whisperCppSchema.parse(JSON.parse(json));
  const segments = p.transcription
    .map((s) => ({ t: [s.offsets.from / 1000, s.offsets.to / 1000] as [number, number], text: s.text.trim() }))
    .filter((s) => s.text && !/^\[.*\]$|^\(.*\)$/.test(s.text)); // drop [MUSIC], (upbeat music)
  return { engine: "whisper-cpp", segments, text: segments.map((s) => s.text).join(" ") };
}

const fasterWhisperSchema = z.object({ segments: z.array(z.object({ start: z.number(), end: z.number(), text: z.string() })) });

export function parseFasterWhisper(json: string): Transcript {
  const p = fasterWhisperSchema.parse(JSON.parse(json));
  const segments = p.segments.map((s) => ({ t: [s.start, s.end] as [number, number], text: s.text.trim() })).filter((s) => s.text);
  return { engine: "faster-whisper", segments, text: segments.map((s) => s.text).join(" ") };
}

/** A pasted transcript (--transcript file): plain text, no timings. */
export function suppliedTranscript(text: string): Transcript {
  const clean = text.replace(/\r/g, "").trim().slice(0, 20_000);
  return { engine: "supplied", segments: clean ? [{ t: [0, 0], text: clean }] : [], text: clean };
}

async function hasBinary(cmd: string, args: string[]): Promise<boolean> {
  try {
    await exec(cmd, args, { timeoutMs: 10_000 });
    return true;
  } catch {
    return false;
  }
}

export async function pickEngine(config: Config): Promise<"whisper-cpp" | "faster-whisper" | "none"> {
  if (config.MX_TRANSCRIBER === "none") return "none";
  if (config.MX_TRANSCRIBER === "whisper-cpp") return "whisper-cpp";
  if (config.MX_TRANSCRIBER === "faster-whisper") return "faster-whisper";
  if ((await hasBinary("whisper-cli", ["--help"])) && existsSync(config.MX_WHISPER_MODEL ?? DEFAULT_GGML)) return "whisper-cpp";
  if (await hasBinary(config.MX_PYTHON, ["-c", "import faster_whisper"])) return "faster-whisper";
  return "none";
}

/** Transcribe `absMedia` into `workDir`. Returns EMPTY_TRANSCRIPT when no engine is available. */
export async function transcribe(absMedia: string, workDir: string, config: Config): Promise<Transcript> {
  const engine = await pickEngine(config);
  if (engine === "none") return EMPTY_TRANSCRIPT;
  if (engine === "whisper-cpp") {
    const model = config.MX_WHISPER_MODEL ?? DEFAULT_GGML;
    if (!existsSync(model)) throw new MixtapeError("whisper-cpp model not found. Set MX_WHISPER_MODEL to a ggml .bin file.");
    const wav = join(workDir, "audio.wav");
    await exec("ffmpeg", ["-hide_banner", "-nostdin", "-loglevel", "error", "-y", "-i", absMedia, "-vn", "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", wav], { timeoutMs: 120_000 });
    const base = join(workDir, "whisper");
    await exec("whisper-cli", ["-m", model, "-f", wav, "-oj", "-of", base, "-np", "-l", config.MX_WHISPER_LANGUAGE], { timeoutMs: 300_000 });
    return parseWhisperCpp(readFileSync(`${base}.json`, "utf8"));
  }
  const out = join(workDir, "faster-whisper.json");
  await exec(config.MX_PYTHON, [PY_SCRIPT, absMedia, out, config.MX_WHISPER_MODEL ?? "small", config.MX_WHISPER_LANGUAGE], { timeoutMs: 600_000 });
  return parseFasterWhisper(readFileSync(out, "utf8"));
}
