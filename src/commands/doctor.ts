import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { loadConfig, secretStatus, type Config } from "../config.js";
import { out } from "../lib/io.js";
import { pickEngine } from "../media/transcribe.js";

const run = promisify(execFile);

export interface Check {
  name: string;
  ok: boolean;
  detail: string;
  /** Which commands need this. A missing optional item only warns. */
  neededFor: string;
  required: boolean;
}

/** Run a tool without a shell and return its first output line, or null if it isn't available. */
async function tool(cmd: string, args: string[]): Promise<string | null> {
  try {
    const { stdout, stderr } = await run(cmd, args, { timeout: 10_000 });
    return shortVersion((stdout || stderr).trim().split("\n")[0] ?? "");
  } catch {
    return null;
  }
}

/** "ffmpeg version 9.0.2 Copyright..." -> "9.0.2"; JSON {"data":{"version":"1.0.1"}} -> "1.0.1". */
export function shortVersion(line: string): string {
  try {
    const v = (JSON.parse(line) as { data?: { version?: unknown } }).data?.version;
    if (typeof v === "string") return v;
  } catch {
    // not JSON
  }
  const m = /\d+\.\d+(?:\.\d+)?/.exec(line);
  return m ? m[0] : line.slice(0, 40);
}

export async function runChecks(config: Config, cwd: string = process.cwd()): Promise<Check[]> {
  const major = Number(process.versions.node.split(".")[0]);
  const secrets = secretStatus(config);
  const [ffmpeg, ffprobe, engine, dreamina, ignored] = await Promise.all([
    tool("ffmpeg", ["-version"]),
    tool("ffprobe", ["-version"]),
    pickEngine(config),
    tool("dreamina-canvas", ["--version"]),
    tool("git", ["-C", cwd, "check-ignore", ".env.local"]),
  ]);
  return [
    { name: "Node.js >= 22", ok: major >= 22, detail: process.versions.node, neededFor: "everything", required: true },
    { name: "ffmpeg", ok: ffmpeg !== null, detail: ffmpeg ?? "not found (brew install ffmpeg)", neededFor: "break, render", required: true },
    { name: "ffprobe", ok: ffprobe !== null, detail: ffprobe ?? "not found (comes with ffmpeg)", neededFor: "break, render", required: true },
    { name: "transcriber", ok: engine !== "none", detail: engine !== "none" ? engine : "none found (brew install whisper-cpp, or pip install faster-whisper)", neededFor: "break (transcripts)", required: false },
    { name: "dreamina-canvas", ok: dreamina !== null, detail: dreamina ?? "not found", neededFor: "render (MX_IMAGE_SOURCE=dreamina)", required: false },
    { name: "ANTHROPIC_API_KEY", ok: secrets.ANTHROPIC_API_KEY === "set", detail: secrets.ANTHROPIC_API_KEY, neededFor: "standalone mode only (later); /mixtape skill mode needs no key", required: false },
    { name: "ELEVENLABS_API_KEY", ok: secrets.ELEVENLABS_API_KEY === "set", detail: secrets.ELEVENLABS_API_KEY, neededFor: "render (voice)", required: false },
    { name: "SEARCHAPI_KEY", ok: secrets.SEARCHAPI_KEY === "set", detail: secrets.SEARCHAPI_KEY, neededFor: "spy (add-on)", required: false },
    { name: ".env.local is gitignored", ok: ignored !== null, detail: ignored !== null ? "yes" : "no: add .env.local to .gitignore", neededFor: "safety", required: true },
  ];
}

export async function doctor(): Promise<number> {
  const config = loadConfig();
  const checks = await runChecks(config);
  out("mixtape doctor");
  for (const c of checks) {
    const mark = c.ok ? "ok  " : c.required ? "FAIL" : "warn";
    out(`  ${mark}  ${c.name.padEnd(26)} ${c.detail}   (${c.neededFor})`);
  }
  out(`  spend ceiling $${config.MX_MAX_SPEND_PER_RUN} per run · images ${config.MX_IMAGE_SOURCE} · voice ${config.MX_VOICE_SOURCE} · spy source ${config.MX_DATA_SOURCE}`);
  const failed = checks.filter((c) => c.required && !c.ok).length;
  out(failed ? `\n${failed} required check(s) failed.` : "\nReady.");
  return failed ? 1 : 0;
}
