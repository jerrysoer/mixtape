import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig, parseEnvFile, secretStatus } from "./config.js";

function dirWith(envLocal?: string): string {
  const dir = mkdtempSync(join(tmpdir(), "mx-config-"));
  if (envLocal !== undefined) writeFileSync(join(dir, ".env.local"), envLocal);
  return dir;
}

describe("loadConfig", () => {
  it("uses defaults when nothing is set", () => {
    const c = loadConfig(dirWith(), {});
    expect(c.MX_DATA_SOURCE).toBe("searchapi");
    expect(c.MX_IMAGE_SOURCE).toBe("dreamina");
    expect(c.MX_VOICE_SOURCE).toBe("elevenlabs");
    expect(c.MX_MAX_SPEND_PER_RUN).toBe(10);
    expect(c.MX_RENDER_MODE).toBe("motion");
    expect(c.MX_VIDEO_MODEL).toBe("seedance_2.5");
    expect(c.MX_CREDITS_PER_VIDEO_SEC).toBe(18);
    expect(c.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it("reads .env.local and lets the real environment win", () => {
    const dir = dirWith('MX_MAX_SPEND_PER_RUN=3\nANTHROPIC_API_KEY="sk-file"\n# comment\n');
    expect(loadConfig(dir, {}).MX_MAX_SPEND_PER_RUN).toBe(3);
    expect(loadConfig(dir, {}).ANTHROPIC_API_KEY).toBe("sk-file");
    expect(loadConfig(dir, { MX_MAX_SPEND_PER_RUN: "2" }).MX_MAX_SPEND_PER_RUN).toBe(2);
  });

  it("ignores .env (only .env.local is read)", () => {
    const dir = dirWith();
    writeFileSync(join(dir, ".env"), "ANTHROPIC_API_KEY=sk-should-not-load\n");
    expect(loadConfig(dir, {}).ANTHROPIC_API_KEY).toBeUndefined();
  });

  it("treats blank keys as missing", () => {
    expect(loadConfig(dirWith("ELEVENLABS_API_KEY=\n"), {}).ELEVENLABS_API_KEY).toBeUndefined();
  });

  it("names the bad setting without echoing any value", () => {
    const dir = dirWith("MX_IMAGE_SOURCE=midjourney\nANTHROPIC_API_KEY=sk-secret-123\n");
    expect(() => loadConfig(dir, {})).toThrowError(/MX_IMAGE_SOURCE/);
    try {
      loadConfig(dir, {});
    } catch (e) {
      expect(String((e as Error).message)).not.toContain("sk-secret-123");
      expect(String((e as Error).message)).not.toContain("midjourney");
    }
  });

  it("refuses a spend ceiling over $100", () => {
    expect(() => loadConfig(dirWith(), { MX_MAX_SPEND_PER_RUN: "500" })).toThrowError(/MX_MAX_SPEND_PER_RUN/);
  });
});

describe("secretStatus", () => {
  it("reports set/missing and never the value", () => {
    const status = secretStatus(loadConfig(dirWith(), { ANTHROPIC_API_KEY: "sk-abc" }));
    expect(status.ANTHROPIC_API_KEY).toBe("set");
    expect(status.SEARCHAPI_KEY).toBe("missing");
    expect(JSON.stringify(status)).not.toContain("sk-abc");
  });
});

describe("parseEnvFile", () => {
  it("handles export prefixes, quotes and junk lines", () => {
    const dir = dirWith("export A=1\nB='two'\nnot a pair\n=nokey\nC=has=equals\n");
    expect(parseEnvFile(join(dir, ".env.local"))).toEqual({ A: "1", B: "two", C: "has=equals" });
  });
});
