import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { loadConfig } from "../config.js";
import { loadFormat } from "../formats.js";
import { projectPaths } from "../lib/jobs.js";
import { structureSchema } from "../schema/structure.js";
import { hookFinish, hookPrep } from "./hook.js";

const root = mkdtempSync(join(tmpdir(), "mx-hook-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const paths = projectPaths(root);
const config = loadConfig(root, {});

const TOPIC = "dial-up internet, 1999";

/** Ten valid scored hooks for the topic (no brand, no source text). */
function answerHooks(): { hooks: { text: string; scroll: number; curiosity: number; fit: number }[] } {
  const lines = [
    "POV: 87% into one song and Mom picks up",
    "POV: the modem screams and the whole house knows",
    "POV: you waited 40 minutes for one picture",
    "POV: someone needs the phone line right now",
    "POV: your parents unplugged the internet again",
    "POV: logging on felt like a rocket launch",
    "POV: you scheduled your homework around the phone bill",
    "POV: one buddy-list sound and your night was made",
    "POV: the progress bar froze at 99%",
    "POV: you heard the dial tone and knew",
  ];
  // hook 0 is the clear winner (10/9/9 = 9.45); the rest score at most 7.40
  return { hooks: lines.map((text, i) => (i === 0 ? { text, scroll: 10, curiosity: 9, fit: 9 } : { text, scroll: 10 - (i % 6), curiosity: 3 + (i % 5), fit: 5 + (i % 4) })) };
}

describe("hook prep + finish (Claude Code answers)", () => {
  it("writes a prompt carrying the pattern, role and topic", async () => {
    const job = await hookPrep("F2", { topic: TOPIC }, paths, config);
    const prompt = readFileSync(join(paths.jobs("hook"), job.id, "prompt.md"), "utf8");
    expect(prompt).toContain("pattern from a proven long-running ad: pov");
    expect(prompt).toContain("names a shared moment of pain");
    expect(prompt).toContain(TOPIC);
    expect(prompt).toContain(`mixtape hook --finish ${job.id}`);
  });

  it("finish ranks the hooks and saves the top 5 into hook.candidates", async () => {
    const job = await hookPrep("F2", { topic: TOPIC }, paths, config);
    writeFileSync(join(paths.jobs("hook"), job.id, "answer.json"), JSON.stringify(answerHooks()));
    const r = hookFinish(job.id, {}, paths);
    expect(r.errors).toEqual([]);
    const saved = structureSchema.parse(JSON.parse(readFileSync(r.outPath as string, "utf8")));
    expect(saved.hook.candidates).toHaveLength(5);
    expect(saved.hook.candidates[0]).toBe("POV: 87% into one song and Mom picks up");
    // everything except the candidates is the untouched format
    expect({ ...saved, hook: { ...saved.hook, candidates: [] } }).toEqual(loadFormat("F2"));
    const scored = JSON.parse(readFileSync(r.hooksPath as string, "utf8")) as { ranked: unknown[]; topic: string };
    expect(scored.ranked).toHaveLength(10);
    expect(scored.topic).toBe(TOPIC);
  });

  it("finish rejects a bad answer and saves nothing", async () => {
    const job = await hookPrep("F2", { topic: TOPIC }, paths, config);
    const bad = answerHooks();
    bad.hooks = bad.hooks.slice(0, 7);
    writeFileSync(join(paths.jobs("hook"), job.id, "answer.json"), JSON.stringify(bad));
    const r = hookFinish(job.id, {}, paths);
    expect(r.ok).toBe(false);
    expect(r.outPath).toBeUndefined();
  });

  it("checks hooks against the source ad cached by break", async () => {
    // a structure that points at a break cache holding a (fictional) transcript
    const cacheId = "fw2-test-abc123";
    const cacheDir = join(paths.jobs("break"), cacheId);
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(join(cacheDir, "transcript.json"), JSON.stringify({ text: "Stop doing cardio before breakfast. Fuelwell fixes your mornings." }));
    const s = { ...loadFormat("F1"), source: { kind: "upload", file_name: "fw2.mp4", cache_id: cacheId } };
    const file = join(root, "fw2.structure.json");
    writeFileSync(file, JSON.stringify(s));
    const job = await hookPrep(file, { topic: "pagers" }, paths, config);
    const copied = answerHooks();
    copied.hooks[0] = { text: "Stop doing cardio before breakfast with pagers", scroll: 9, curiosity: 9, fit: 9 };
    writeFileSync(join(paths.jobs("hook"), job.id, "answer.json"), JSON.stringify(copied));
    expect(hookFinish(job.id, {}, paths).errors.join()).toMatch(/hooks\.0: shares 5 words/);
  });

  it("requires a topic and a valid structure", async () => {
    await expect(hookPrep("F2", { topic: " " }, paths, config)).rejects.toThrow(/--topic/);
    const broken = join(root, "broken.structure.json");
    writeFileSync(broken, JSON.stringify({ format: "x" }));
    await expect(hookPrep(broken, { topic: TOPIC }, paths, config)).rejects.toThrow(/not a valid structure/);
  });
});

describe("hook --offline (template fallback)", () => {
  it("fills five template hooks for the pattern with no Claude step", async () => {
    const job = await hookPrep("F7", { topic: "slap bracelets", offline: true }, paths, config);
    const saved = structureSchema.parse(JSON.parse(readFileSync(job.outPath as string, "utf8")));
    expect(saved.hook.pattern).toBe("number_shock");
    expect(saved.hook.candidates).toEqual(["Slap bracelets for less than a coffee.", "This saved me 4 hours of slap bracelets.", "90% of people get slap bracelets wrong.", "I spent $300 on slap bracelets. Worth it?", "Slap bracelets: 3 seconds, zero effort."]);
  });
});

describe("AUTOHOOK_PATH", () => {
  it("uses AutoHook's candidates when it fills them in", async () => {
    const script = join(root, "autohook.mjs");
    writeFileSync(
      script,
      `#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
const f = process.argv[2]; const s = JSON.parse(readFileSync(f, "utf8"));
s.hook.candidates = ["A1 for " + process.argv[4], "A2", "A3", "A4", "A5", "A6"];
writeFileSync(f, JSON.stringify(s));
`,
    );
    chmodSync(script, 0o755);
    const job = await hookPrep("F3", { topic: "walkmans" }, paths, loadConfig(root, { AUTOHOOK_PATH: script }));
    const saved = structureSchema.parse(JSON.parse(readFileSync(job.outPath as string, "utf8")));
    expect(saved.hook.candidates).toEqual(["A1 for walkmans", "A2", "A3", "A4", "A5"]);
    expect(job.engine).toBe("autohook");
  });

  it("falls back to the Claude prompt, with a warning, when AutoHook fails", async () => {
    const job = await hookPrep("F3", { topic: "walkmans" }, paths, loadConfig(root, { AUTOHOOK_PATH: join(root, "missing-autohook") }));
    expect(job.engine).toBe("claude");
    expect(job.outPath).toBeUndefined();
  });
});
