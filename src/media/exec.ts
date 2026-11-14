import { execFile } from "node:child_process";
import { MixtapeError } from "../lib/io.js";

export interface ExecResult {
  stdout: string;
  stderr: string;
}

/**
 * Run a binary WITHOUT a shell (no injection through file names or ad text).
 * Callers pass absolute paths so a name like "-i" can never be read as a flag.
 */
export function exec(cmd: string, args: string[], opts: { timeoutMs?: number; maxBuffer?: number } = {}): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      { timeout: opts.timeoutMs ?? 300_000, maxBuffer: opts.maxBuffer ?? 64 * 1024 * 1024, windowsHide: true },
      (error, stdout, stderr) => {
        if (error) {
          const tail = String(stderr).trim().split("\n").slice(-3).join(" | ");
          const why = (error as NodeJS.ErrnoException).code === "ENOENT" ? "not installed (run mixtape doctor)" : tail || error.message;
          reject(new MixtapeError(`${cmd} failed: ${why}`));
          return;
        }
        resolve({ stdout: String(stdout), stderr: String(stderr) });
      },
    );
  });
}
