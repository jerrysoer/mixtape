import { lookup } from "node:dns/promises";
import { createWriteStream } from "node:fs";
import { rename, rm } from "node:fs/promises";
import { isIP } from "node:net";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { MixtapeError } from "../lib/io.js";

export const MAX_DOWNLOAD_BYTES = 250 * 1024 * 1024;
const TIMEOUT_MS = 120_000;
const MAX_REDIRECTS = 3;
const RETRIES = 3;

/** Host only: signed media URLs carry tokens, so the full URL is never logged or stored. */
export function safeHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "(invalid url)";
  }
}

const PRIVATE_V4 = [/^127\./, /^10\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./, /^169\.254\./, /^0\./, /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./];

export function isPrivateAddress(ip: string): boolean {
  const v = ip.toLowerCase().replace(/^::ffff:/, "");
  if (isIP(v) === 4) return PRIVATE_V4.some((r) => r.test(v));
  return v === "::" || v === "::1" || /^f[cd]/.test(v) || /^fe[89ab]/.test(v);
}

/** https only, no credentials in the URL, and the host must not resolve to a private address. */
export async function assertPublicHttpsUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new MixtapeError("That link is not a valid URL.");
  }
  if (url.protocol !== "https:") throw new MixtapeError("Only https:// links are downloaded.");
  if (url.username || url.password) throw new MixtapeError("Links with embedded credentials are refused.");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) throw new MixtapeError("Links to local hosts are refused.");
  const addrs = isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => []);
  if (addrs.length === 0) throw new MixtapeError(`Could not resolve ${host}.`);
  if (addrs.some((a) => isPrivateAddress(a.address))) throw new MixtapeError(`${host} points to a private address; refused.`);
  return url;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Download a public video to `dest` (inside .cache/sources/). Follows up to 3 redirects,
 * re-checking each hop, caps size, requires a video/* or octet-stream content type,
 * and retries transient failures with backoff.
 */
export async function downloadVideo(raw: string, dest: string): Promise<{ bytes: number; host: string }> {
  let lastError: unknown;
  for (let attempt = 0; attempt < RETRIES; attempt++) {
    if (attempt) await sleep(500 * 2 ** attempt);
    try {
      return await downloadOnce(raw, dest);
    } catch (e) {
      lastError = e;
      if (e instanceof MixtapeError && !/HTTP 5\d\d|timed out|network/i.test(e.message)) throw e; // permanent
    }
  }
  throw lastError instanceof Error ? lastError : new MixtapeError("Download failed.");
}

async function downloadOnce(raw: string, dest: string): Promise<{ bytes: number; host: string }> {
  let url = await assertPublicHttpsUrl(raw);
  let res: Response | undefined;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    try {
      res = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS), headers: { "user-agent": "mixtape-cli" } });
    } catch (e) {
      const timedOut = e instanceof Error && e.name === "TimeoutError";
      throw new MixtapeError(`Download from ${url.hostname} ${timedOut ? "timed out" : "hit a network error"}.`);
    }
    if (res.status >= 300 && res.status < 400) {
      const next = res.headers.get("location");
      if (!next || hop === MAX_REDIRECTS) throw new MixtapeError(`Too many redirects from ${url.hostname}.`);
      url = await assertPublicHttpsUrl(new URL(next, url).toString());
      continue;
    }
    break;
  }
  if (!res?.ok || !res.body) throw new MixtapeError(`Download from ${url.hostname} failed: HTTP ${res?.status ?? "?"}. Signed ad links expire; pull the ad again.`);
  const type = (res.headers.get("content-type") ?? "").toLowerCase();
  if (!type.startsWith("video/") && !type.startsWith("application/octet-stream")) {
    throw new MixtapeError(`${url.hostname} did not return a video (content-type ${type || "missing"}).`);
  }
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (declared > MAX_DOWNLOAD_BYTES) throw new MixtapeError(`Video is larger than ${MAX_DOWNLOAD_BYTES / 1024 / 1024} MB.`);

  const tmp = `${dest}.part`;
  let bytes = 0;
  const body = Readable.fromWeb(res.body as import("node:stream/web").ReadableStream<Uint8Array>);
  body.on("data", (chunk: Buffer) => {
    bytes += chunk.length;
    if (bytes > MAX_DOWNLOAD_BYTES) body.destroy(new MixtapeError(`Video is larger than ${MAX_DOWNLOAD_BYTES / 1024 / 1024} MB.`));
  });
  try {
    await pipeline(body, createWriteStream(tmp, { mode: 0o600 }));
  } catch (e) {
    await rm(tmp, { force: true });
    throw e instanceof MixtapeError ? e : new MixtapeError(`Download from ${url.hostname} hit a network error.`);
  }
  await rename(tmp, dest);
  return { bytes, host: url.hostname };
}
