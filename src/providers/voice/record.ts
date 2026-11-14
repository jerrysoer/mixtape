import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { MixtapeError, out } from "../../lib/io.js";
import { exec } from "../../media/exec.js";
import type { Budget } from "../../render/budget.js";
import type { Word } from "../../render/timeline.js";
import { charsToWords, heardWrong, offsetWords, type LineWord } from "./align.js";

/** Silence between lines when lines are recorded one by one (the free `say` path). */
export const LINE_GAP_S = 0.35;
const MAX_TAKES = 3;
/** Cut-out margins for a shot's line inside the one-take narration (lip refs are trimmed tight later). */
const LINE_LEAD_S = 0.15;
const LINE_TAIL_S = 0.3;

export interface VoiceLine {
  shot: number;
  text: string;
}

export interface VoiceResult {
  wav: string;
  words: Word[];
  takes: { shot: number; take: number; seed: number; cached: boolean; verdict: string }[];
}

async function seconds(file: string): Promise<number> {
  const { stdout } = await exec("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file], { timeoutMs: 15_000 });
  const n = Number(stdout.trim());
  if (!Number.isFinite(n) || n <= 0) throw new MixtapeError(`Could not read the length of ${file}.`);
  return n;
}

/** Decode every line to 48 kHz mono WAV, join with LINE_GAP_S of silence, shift word times. */
async function joinLines(dir: string, parts: { audio: string; words: LineWord[]; shot: number }[]): Promise<{ wav: string; words: Word[] }> {
  const work = join(dir, "lines");
  mkdirSync(work, { recursive: true });
  const gap = join(work, "gap.wav");
  await exec("ffmpeg", ["-hide_banner", "-nostdin", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=mono", "-t", String(LINE_GAP_S), "-c:a", "pcm_s16le", gap]);
  const list: string[] = [];
  const words: Word[] = [];
  let offset = 0;
  for (const [i, p] of parts.entries()) {
    const wav = join(work, `line_${String(i + 1).padStart(2, "0")}.wav`);
    await exec("ffmpeg", ["-hide_banner", "-nostdin", "-loglevel", "error", "-y", "-i", p.audio, "-ac", "1", "-ar", "48000", "-c:a", "pcm_s16le", wav]);
    if (i > 0) {
      list.push(`file '${gap}'`);
      offset += LINE_GAP_S;
    }
    list.push(`file '${wav}'`);
    words.push(...offsetWords(p.words, offset, p.shot));
    offset += await seconds(wav);
  }
  const listFile = join(work, "lines.txt");
  writeFileSync(listFile, list.join("\n") + "\n");
  const outWav = join(dir, "narration.wav");
  await exec("ffmpeg", ["-hide_banner", "-nostdin", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", outWav]);
  writeFileSync(join(dir, "words.json"), JSON.stringify(words, null, 1) + "\n");
  return { wav: outWav, words };
}

/** Even word timings across a line (the free `say` voice gives no timestamps). Rough cuts only. */
export function evenWords(text: string, duration: number): LineWord[] {
  const ws = text.split(/\s+/).filter(Boolean);
  const total = ws.reduce((a, w) => a + w.length + 1, 0);
  let t = 0;
  return ws.map((w) => {
    const d = ((w.length + 1) / total) * duration;
    const word = { w, s: Math.round(t * 1000) / 1000, e: Math.round((t + d) * 1000) / 1000 };
    t += d;
    return word;
  });
}

/** Free placeholder narration with macOS `say` (nothing judged on it; DECISIONS sprint 4). */
export async function recordSay(lines: VoiceLine[], dir: string): Promise<VoiceResult> {
  mkdirSync(join(dir, "say"), { recursive: true });
  const parts: { audio: string; words: LineWord[]; shot: number }[] = [];
  for (const [i, l] of lines.entries()) {
    const txt = join(dir, "say", `line_${i + 1}.txt`);
    const aiff = join(dir, "say", `line_${i + 1}.aiff`);
    writeFileSync(txt, l.text);
    await exec("say", ["-r", "110", "-o", aiff, "-f", txt], { timeoutMs: 60_000 });
    parts.push({ audio: aiff, words: evenWords(l.text, await seconds(aiff)), shot: l.shot });
  }
  const j = await joinLines(dir, parts);
  return { ...j, takes: lines.map((l) => ({ shot: l.shot, take: 1, seed: 0, cached: false, verdict: "placeholder" })) };
}

export interface ElevenOptions {
  key: string;
  voiceId: string;
  model: string;
  usdPer1kChars: number;
  budget: Budget;
  /** ElevenLabs voice_settings for every take (account.json narrator.voice_settings). */
  voiceSettings?: { stability: number; similarity_boost: number } | undefined;
  /** Delivery tag in front of the take ("[casual, amused]"); stripped from the words. */
  deliveryTag?: string | undefined;
  whisperModel?: string;
  fetchImpl?: typeof fetch;
  /** Transcribe a take for the repeat check; returns "" when no checker is available. */
  hear?: (audio: string) => Promise<string>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** POST with backoff on 429/5xx. Errors carry the status only, never the key or body. */
async function postJson(url: string, body: unknown, key: string, f: typeof fetch): Promise<unknown> {
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt) await sleep(800 * 2 ** attempt);
    let res: Response;
    try {
      res = await f(url, { method: "POST", headers: { "xi-api-key": key, "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(120_000) });
    } catch {
      if (attempt === 3) throw new MixtapeError("ElevenLabs could not be reached.");
      continue;
    }
    if (res.ok) return res.json();
    if (res.status !== 429 && res.status < 500) throw new MixtapeError(`ElevenLabs refused the request: HTTP ${res.status}.`);
    if (attempt === 3) throw new MixtapeError(`ElevenLabs kept failing: HTTP ${res.status}.`);
  }
  throw new MixtapeError("ElevenLabs request failed.");
}

export async function whisperHear(audio: string, model: string): Promise<string> {
  if (!existsSync(model)) return "";
  const wav = `${audio}.16k.wav`;
  await exec("ffmpeg", ["-hide_banner", "-nostdin", "-loglevel", "error", "-y", "-i", audio, "-ar", "16000", "-ac", "1", wav]);
  try {
    const { stdout } = await exec("whisper-cli", ["-m", model, "-f", wav, "-nt", "-np", "-l", "en"], { timeoutMs: 120_000 });
    return stdout;
  } catch {
    return "";
  }
}

/** Cache key of one narration take (also used by render to see which text is already paid for). */
export function takeKey(voiceId: string, model: string, text: string, seed: number): string {
  return createHash("sha1").update(JSON.stringify([voiceId, model, text, seed])).digest("hex");
}

export const DEFAULT_VERIFY_MODEL = join(homedir(), ".local/share/whisper-models/ggml-small.en.bin");

/** The whole ad as ONE take: every line in order, one space apart (what the narrator reads). */
export function takeText(lines: Pick<VoiceLine, "text">[]): string {
  return lines.map((l) => l.text.trim()).filter(Boolean).join(" ");
}

/** What is sent (and billed): the delivery tag, if any, in front of the text. */
export function takeBody(text: string, tag?: string): string {
  return tag ? `${tag} ${text}` : text;
}

/** How many spoken words a line has, counted the way the alignment splits them (tags dropped). */
function spokenWordCount(text: string): number {
  return charsToWords([...text], [], []).length;
}

/**
 * Give each word of the take its shot: the lines are read in order, so the first line's words
 * come first, and so on. The counts must add up; a mismatch means the alignment dropped or added
 * a word (never seen with v3/v4, which align every character), so it is an error, not a guess.
 */
export function splitWordsByLine(words: LineWord[], lines: VoiceLine[]): Word[] {
  const out: Word[] = [];
  let i = 0;
  for (const l of lines) {
    const n = spokenWordCount(l.text);
    for (let k = 0; k < n; k++) {
      const w = words[i++];
      if (!w) throw new MixtapeError(`The narration alignment has fewer words than the script (ran out in shot ${l.shot}).`);
      out.push({ ...w, shot: l.shot });
    }
  }
  if (i !== words.length) throw new MixtapeError(`The narration alignment has ${words.length - i} more word(s) than the script.`);
  return out;
}

/**
 * ElevenLabs narration as ONE take of the whole ad (a line-by-line read ran 31 s where one take
 * ran 24.6 s on ep 7, 2026-11-07, and sounded stiffer), with character timestamps split back into
 * shots. Content-keyed cache (an unchanged take is never billed again), checked by ear (whisper)
 * and retaken on a new seed up to 3 times. Each shot's line is also cut out to lines/line_NN.wav
 * for the lip-sync refs. Every take reserves its cost in the approved budget first.
 */
export async function recordEleven(lines: VoiceLine[], dir: string, o: ElevenOptions): Promise<VoiceResult> {
  const cache = join(dir, "cache");
  mkdirSync(cache, { recursive: true });
  const f = o.fetchImpl ?? fetch;
  const hear = o.hear ?? ((a: string) => whisperHear(a, o.whisperModel ?? DEFAULT_VERIFY_MODEL));
  const text = takeText(lines);
  const body = takeBody(text, o.deliveryTag);
  const takes: VoiceResult["takes"] = [];
  let picked: { mp3: string; words: LineWord[] } | null = null;

  for (let take = 1; take <= MAX_TAKES && !picked; take++) {
    const seed = take - 1;
    const key = takeKey(o.voiceId, o.model, body, seed);
    const mp3 = join(cache, `${key}.mp3`);
    const meta = join(cache, `${key}.json`);
    const cached = existsSync(mp3) && existsSync(meta);
    if (!cached) {
      o.budget.reserve(`narration take ${take} (${body.length} chars)`, 0, (body.length / 1000) * o.usdPer1kChars);
      const d = (await postJson(
        `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(o.voiceId)}/with-timestamps?output_format=mp3_44100_128`,
        { text: body, model_id: o.model, ...(seed ? { seed } : {}), ...(o.voiceSettings ? { voice_settings: o.voiceSettings } : {}) },
        o.key,
        f,
      )) as { audio_base64?: string; alignment?: { characters: string[]; character_start_times_seconds: number[]; character_end_times_seconds: number[] } };
      if (!d.audio_base64 || !d.alignment) throw new MixtapeError("ElevenLabs returned no audio or no timestamps.");
      writeFileSync(mp3, Buffer.from(d.audio_base64, "base64"));
      writeFileSync(meta, JSON.stringify({ words: charsToWords(d.alignment.characters, d.alignment.character_start_times_seconds, d.alignment.character_end_times_seconds) }));
    }
    const verdict = heardWrong(await hear(mp3), text);
    takes.push({ shot: 0, take, seed, cached, verdict: verdict || "ok" });
    if (!verdict || take === MAX_TAKES) {
      if (verdict) out(`  warn: the narration still sounds wrong after ${MAX_TAKES} takes (${verdict}); kept the last take for QC.`);
      picked = { mp3, words: (JSON.parse(readFileSync(meta, "utf8")) as { words: LineWord[] }).words };
    } else {
      out(`  narration take ${take}: ${verdict}; retaking on a new seed`);
    }
  }
  if (!picked) throw new MixtapeError("No narration take.");

  const words = splitWordsByLine(picked.words, lines);
  const wav = join(dir, "narration.wav");
  await exec("ffmpeg", ["-hide_banner", "-nostdin", "-loglevel", "error", "-y", "-i", picked.mp3, "-ac", "1", "-ar", "48000", "-c:a", "pcm_s16le", wav]);
  const total = await seconds(wav);
  // One file per shot's line (in script order), cut from the take, for the lip-sync refs (sync.ts tightRef).
  const work = join(dir, "lines");
  mkdirSync(work, { recursive: true });
  for (const [i, l] of lines.entries()) {
    const mine = words.filter((w) => w.shot === l.shot);
    const first = mine[0];
    const last = mine.at(-1);
    if (!first || !last) continue;
    const from = Math.max(0, first.s - LINE_LEAD_S);
    const to = Math.min(total, last.e + LINE_TAIL_S);
    await exec("ffmpeg", ["-hide_banner", "-nostdin", "-loglevel", "error", "-y", "-i", wav, "-ss", from.toFixed(3), "-to", to.toFixed(3), "-c:a", "pcm_s16le", join(work, `line_${String(i + 1).padStart(2, "0")}.wav`)]);
  }
  writeFileSync(join(dir, "words.json"), JSON.stringify(words, null, 1) + "\n");
  return { wav, words, takes };
}
