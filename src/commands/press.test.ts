import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { loadFormat } from "../formats.js";
import { projectPaths } from "../lib/jobs.js";
import { scriptSchema } from "../schema/script.js";
import { pressFinish, pressPrep } from "./press.js";

const root = mkdtempSync(join(tmpdir(), "mx-press-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const paths = projectPaths(root);

const BRIEF = "Plateful plans a week of meals in 2 minutes and builds one shopping list sorted by aisle. In a 2026 beta, testers went from 4 takeout nights a week to 1. Offer: 14-day free trial.";
const HOOK = "I quit over takeout.";

/** A valid answer for F1 (founder story: setup, problem, solution, cta; 22 s). 4 + 4×12 words = 20.8 s. */
function answer(overrides: { lines?: Partial<Record<number, string>>; roles?: string[]; style?: boolean } = {}) {
  const lines = [
    "Two years ago I was ordering takeout four nights every single week.",
    "The fridge stayed full, the groceries rotted, and dinner was always late.",
    "So I built Plateful: a week of meals planned in two minutes.",
    "Try it free for fourteen days and plan your first week tonight.",
  ].map((l, i) => overrides.lines?.[i] ?? l);
  const roles = overrides.roles ?? ["setup", "problem", "solution", "cta"];
  const shot = (set: string, who: boolean) => ({
    set,
    time: "evening",
    camera: "medium, eye level",
    people: who ? { FOUNDER: "leaning on the counter, half smile" } : {},
    extras: "none",
    wear: who ? { FOUNDER: "default" } : {},
  });
  return {
    hook: { visual: "the founder at a kitchen counter piled with takeout bags", shot: shot("KITCHEN", true) },
    beats: lines.map((line, i) => ({ role: roles[i], line, visual: `picture ${i + 1}`, shot: shot(i === 2 ? "DESK" : "KITCHEN", i !== 2) })),
    cast: { FOUNDER: "man in his forties, short grey hair, light olive skin, brown eyes, lean build" },
    wardrobe: { FOUNDER: { default: "navy crewneck sweater, dark jeans" } },
    sets: {
      KITCHEN: "INTERIOR ONLY: a small apartment kitchen, flat white ceiling, warm pendant light",
      DESK: "INTERIOR ONLY: a home office desk by a window, flat ceiling, cool daylight",
    },
    ...(overrides.style === false ? {} : { style_prompt: "warm flat illustration, soft evening light, 9:16" }),
  };
}

function writeAnswer(id: string, body: unknown): void {
  writeFileSync(join(paths.jobs("press"), id, "answer.json"), JSON.stringify(body));
}

describe("press prep", () => {
  it("writes a prompt with the brief fenced, the fixed hook and per-beat word budgets", async () => {
    const job = await pressPrep("F1", BRIEF, { hookLine: HOOK }, paths);
    const prompt = readFileSync(join(paths.jobs("press"), job.id, "prompt.md"), "utf8");
    expect(prompt).toMatch(/<<<UNTRUSTED_[0-9a-f]{12} BRIEF\nPlateful plans/);
    expect(prompt).toContain(`"${HOOK}"`);
    expect(prompt).toContain("**setup** 2.00-7.00 s (5.0 s → 12-13 words)");
    expect(prompt).toContain(`mixtape press --finish ${job.id}`);
  });

  it("with no hooks on the structure and no --hook-line, press writes the hook in the same step (held to the hook rules at finish)", async () => {
    const job = await pressPrep("F1", BRIEF, {}, paths);
    const prompt = readFileSync(join(paths.jobs("press"), job.id, "prompt.md"), "utf8");
    expect(prompt).toContain("## HOOK (write it");
    expect(prompt).toContain("**max 5 words** spoken");
    expect(prompt).toContain('"line": "<the hook line>"');
    expect(JSON.parse(readFileSync(join(paths.jobs("press"), job.id, "job.json"), "utf8"))).toMatchObject({ hookLine: null });
    // no hook in the answer, or one that overruns the 2 s window, is refused; a good one is saved
    writeAnswer(job.id, answer());
    expect(pressFinish(job.id, {}, paths).errors.join()).toMatch(/hook\.line: required/);
    writeAnswer(job.id, { ...answer(), hook: { ...answer().hook, line: "I left my job to sort dinner out properly" } });
    expect(pressFinish(job.id, {}, paths).errors.join()).toMatch(/hook\.line: 9 words; .* max 5/);
    writeAnswer(job.id, { ...answer(), hook: { ...answer().hook, line: HOOK } });
    const r = pressFinish(job.id, {}, paths);
    expect(r.errors).toEqual([]);
    expect(r.script?.hook.line).toBe(HOOK);
    expect(r.script?.hook_candidates).toEqual([]);
    // --hook with no candidates still points at mixtape hook
    await expect(pressPrep("F1", BRIEF, { hook: "2" }, paths)).rejects.toThrow(/mixtape hook/);
  });

  it("a fixed hook stays fixed: an answer may repeat it exactly, not change it", async () => {
    const job = await pressPrep("F1", BRIEF, { hookLine: HOOK }, paths);
    writeAnswer(job.id, { ...answer(), hook: { ...answer().hook, line: "Something else." } });
    expect(pressFinish(job.id, {}, paths).errors.join()).toMatch(/hook\.line: the hook is fixed/);
    writeAnswer(job.id, { ...answer(), hook: { ...answer().hook, line: HOOK } });
    expect(pressFinish(job.id, {}, paths).errors).toEqual([]);
  });

  it("picks candidate n with --hook and carries scores from the .hooks.json beside the structure", async () => {
    const s = { ...loadFormat("F1"), hook: { ...loadFormat("F1").hook, candidates: ["First hook here.", "I quit over takeout."] } };
    const file = join(root, "f1-plateful.structure.json");
    writeFileSync(file, JSON.stringify(s));
    writeFileSync(join(root, "f1-plateful.hooks.json"), JSON.stringify({ ranked: [{ text: "First hook here.", score: 8.1 }, { text: "I quit over takeout.", score: 7.2 }] }));
    const job = await pressPrep(file, BRIEF, { hook: "2" }, paths);
    writeAnswer(job.id, answer());
    const r = pressFinish(job.id, {}, paths);
    expect(r.errors).toEqual([]);
    const script = scriptSchema.parse(JSON.parse(readFileSync(r.outPath as string, "utf8")));
    expect(script.hook.line).toBe(HOOK);
    expect(script.hook_candidates).toEqual([
      { text: "First hook here.", score: 8.1 },
      { text: "I quit over takeout.", score: 7.2 },
    ]);
  });

  it("refuses a spoken hook that can't fit its window, naming the candidates that do", async () => {
    // F1 is a voice format with a 2 s hook: 5 words max
    const s = { ...loadFormat("F1"), hook: { ...loadFormat("F1").hook, candidates: ["I left my job to sort dinner out properly", "I quit over takeout."] } };
    const file = join(root, "f1-long-hook.structure.json");
    writeFileSync(file, JSON.stringify(s));
    await expect(pressPrep(file, BRIEF, {}, paths)).rejects.toThrow(/9 words.*2\.0 s.*max 5.*--hook 2/s);
  });

  it("allows a long on-screen hook in a captions-only format", async () => {
    // F2 (POV) has no voice: the hook is a caption that holds into the next beat
    await expect(pressPrep("F2", BRIEF, { hookLine: "POV: 87% into one song and Mom picks up the phone" }, paths)).resolves.toBeDefined();
  });

  it("refuses a brief that is too short", async () => {
    await expect(pressPrep("F1", "meals", { hookLine: HOOK }, paths)).rejects.toThrow(/brief/);
  });
});

describe("press finish", () => {
  it("saves a schema-valid script.json with the structure's times and passing checks", async () => {
    const job = await pressPrep("F1", BRIEF, { hookLine: HOOK }, paths);
    writeAnswer(job.id, answer());
    const r = pressFinish(job.id, {}, paths);
    expect(r.errors).toEqual([]);
    const script = scriptSchema.parse(JSON.parse(readFileSync(r.outPath as string, "utf8")));
    const f1 = loadFormat("F1");
    expect(script.beats.map((b) => b.t)).toEqual(f1.beats.map((b) => b.t));
    expect(script.hook).toMatchObject({ t: f1.hook.t, pattern: f1.hook.pattern, line: HOOK });
    expect(script.checks).toEqual({ overlap_passed: true, max_overlap_words: 0, timing_within_10pct: true, claims_in_brief: true, words_per_second: 2.5 });
    expect(script.style_lock).toEqual({ style_prompt: "warm flat illustration, soft evening light, 9:16", reference_image: null });
    expect(script.structure).toMatchObject({ ref: "F1", format: "founder_talking_head", duration_s: 22 });
  });

  it("--imperfect lays disfluencies over the audited lines, never the hook, and records rate and seed", async () => {
    const job = await pressPrep("F1", BRIEF, { hookLine: HOOK, imperfect: "0.2", seed: "9" }, paths);
    writeAnswer(job.id, answer());
    const r = pressFinish(job.id, {}, paths);
    expect(r.errors).toEqual([]);
    const script = scriptSchema.parse(JSON.parse(readFileSync(r.outPath as string, "utf8")));
    expect(script.audio.imperfect).toEqual({ rate: 0.2, seed: 9 });
    expect(script.hook.line).toBe(HOOK);
    expect(script.checks.timing_within_10pct).toBe(true);
    const clean = answer().beats.map((b) => b.line);
    expect(script.beats.map((b) => b.line)).not.toEqual(clean);
    expect(script.beats.at(-1)?.line.endsWith("plan your first week tonight.")).toBe(true);
    await expect(pressPrep("F1", BRIEF, { hookLine: HOOK, imperfect: "0.5" }, paths)).rejects.toThrow(/--imperfect must be 0-0.3/);
  });

  it("blocks a deliberately copied script and saves nothing", async () => {
    const cacheId = "fw2-copy-abc123";
    mkdirSync(join(paths.jobs("break"), cacheId), { recursive: true });
    writeFileSync(join(paths.jobs("break"), cacheId, "transcript.json"), JSON.stringify({ text: "Two years ago I was ordering takeout four nights every single week, and I hated it." }));
    const file = join(root, "fw2.structure.json");
    writeFileSync(file, JSON.stringify({ ...loadFormat("F1"), source: { kind: "upload", file_name: "fw2.mp4", cache_id: cacheId } }));
    const job = await pressPrep(file, BRIEF, { hookLine: HOOK }, paths);
    writeAnswer(job.id, answer());
    const r = pressFinish(job.id, {}, paths);
    expect(r.ok).toBe(false);
    expect(r.errors.join()).toMatch(/beats\.0\.line: shares 12 words in a row with the source ad/);
    expect(r.outPath).toBeUndefined();
  });

  it("rejects a claim number the brief doesn't contain", async () => {
    const job = await pressPrep("F1", BRIEF, { hookLine: HOOK }, paths);
    writeAnswer(job.id, answer({ lines: { 3: "Try it free for thirty days and plan your first week tonight." } }));
    expect(pressFinish(job.id, {}, paths).errors.join()).toMatch(/beats\.3\.line: "30" is not in the brief/);
  });

  it("rejects beats out of the structure's role order", async () => {
    const job = await pressPrep("F1", BRIEF, { hookLine: HOOK }, paths);
    writeAnswer(job.id, answer({ roles: ["problem", "setup", "solution", "cta"] }));
    expect(pressFinish(job.id, {}, paths).errors.join()).toMatch(/beats\.0\.role: expected setup/);
  });

  it("rejects a line that overruns its window", async () => {
    const job = await pressPrep("F1", BRIEF, { hookLine: HOOK }, paths);
    writeAnswer(job.id, answer({ lines: { 1: "The fridge stayed full, the groceries rotted, the lettuce went brown, and dinner was always late again." } }));
    expect(pressFinish(job.id, {}, paths).errors.join()).toMatch(/beats\.1\.line: ~6\.8 s of speech in a 5\.0 s window/); // 17 words
  });

  it("falls back to the account's default look when no --style is given", async () => {
    const acctRoot = mkdtempSync(join(tmpdir(), "mx-press-acct-"));
    mkdirSync(join(acctRoot, "renders"), { recursive: true });
    writeFileSync(join(acctRoot, "renders", "account.json"), JSON.stringify({ style_default: "late-90s home video still, 9:16" }));
    const p2 = projectPaths(acctRoot);
    const job = await pressPrep("F1", BRIEF, { hookLine: HOOK }, p2);
    writeFileSync(join(p2.jobs("press"), job.id, "answer.json"), JSON.stringify(answer({ style: false })));
    const r = pressFinish(job.id, {}, p2);
    expect(r.errors).toEqual([]);
    expect(r.script?.style_lock.style_prompt).toBe("late-90s home video still, 9:16");
    rmSync(acctRoot, { recursive: true, force: true });
  });

  it("uses --style over the answer, and needs a style when none was given", async () => {
    const styled = await pressPrep("F1", BRIEF, { hookLine: HOOK, style: "grainy 1999 camcorder still, 9:16" }, paths);
    writeAnswer(styled.id, answer({ style: false }));
    const r = pressFinish(styled.id, {}, paths);
    expect(r.errors).toEqual([]);
    expect(JSON.parse(readFileSync(r.outPath as string, "utf8")).style_lock.style_prompt).toBe("grainy 1999 camcorder still, 9:16");

    const unstyled = await pressPrep("F1", BRIEF, { hookLine: HOOK }, paths);
    writeAnswer(unstyled.id, answer({ style: false }));
    expect(pressFinish(unstyled.id, {}, paths).errors.join()).toMatch(/style_prompt/);
  });
});

describe("press --register (monologue first)", () => {
  const BANK = `# bank\n\n## Registers\n\n| id | who | move | rhythm | tag | example | used | verdict |\n|---|---|---|---|---|---|---|---|\n| \`late_night_confession\` | you → friend, lower voice | admits a thing | slower | \`[quiet, confiding]\` | "I need to tell you something" | — | — |\n`;
  it("quotes the register in the prompt, requires a monologue that the split adds back up to, and records register + tag in the script", async () => {
    const rroot = mkdtempSync(join(tmpdir(), "mx-press-reg-"));
    mkdirSync(join(rroot, "docs"), { recursive: true });
    writeFileSync(join(rroot, "docs", "NARRATION-BANK.md"), BANK);
    const rp = projectPaths(rroot);
    await expect(pressPrep("F1", BRIEF, { hookLine: HOOK, register: "voice_note" }, rp)).rejects.toThrow(/No register "voice_note".*Known: late_night_confession/);
    const job = await pressPrep("F1", BRIEF, { hookLine: HOOK, register: "late_night_confession" }, rp);
    const prompt = readFileSync(join(rp.jobs("press"), job.id, "prompt.md"), "utf8");
    expect(prompt).toContain("## REGISTER: `late_night_confession`");
    expect(prompt).toContain("[quiet, confiding]");
    expect(prompt).toContain('"monologue"');
    const w = (body: unknown) => writeFileSync(join(rp.jobs("press"), job.id, "answer.json"), JSON.stringify(body));
    w(answer());
    expect(pressFinish(job.id, {}, rp).errors.join()).toMatch(/monologue: required/);
    const lines = answer().beats.map((b) => b.line);
    w({ ...answer(), monologue: [HOOK, ...lines.slice(0, 3), "Try it free for fourteen days."].join(" ") });
    expect(pressFinish(job.id, {}, rp).errors.join()).toMatch(/monologue: .*word for word/);
    w({ ...answer(), monologue: `${HOOK}  ${lines.join("\n")}` });
    const r = pressFinish(job.id, {}, rp);
    expect(r.errors).toEqual([]);
    expect(r.script?.audio).toMatchObject({ register: "late_night_confession", delivery_tag: "[quiet, confiding]" });
    rmSync(rroot, { recursive: true, force: true });
  });
});

describe("speaking rate from the account", () => {
  it("audits and prompts at the narrator's measured words/s for the render mode and records it in checks", async () => {
    const rroot = mkdtempSync(join(tmpdir(), "mx-press-rate-"));
    mkdirSync(join(rroot, "renders"), { recursive: true });
    writeFileSync(join(rroot, "renders", "account.json"), JSON.stringify({ narrator: { provider: "elevenlabs", model: "eleven_v3", model_motion: "eleven_v4", voice_id: "abcdefghijkl", words_per_second: { eleven_v4: 2.2 } } }));
    const rp = projectPaths(rroot);
    const job = await pressPrep("F1", BRIEF, { hookLine: HOOK }, rp);
    const prompt = readFileSync(join(rp.jobs("press"), job.id, "prompt.md"), "utf8");
    expect(prompt).toContain("2.2 words/sec");
    expect(JSON.parse(readFileSync(join(rp.jobs("press"), job.id, "job.json"), "utf8"))).toMatchObject({ wordsPerSecond: 2.2 });
    rmSync(rroot, { recursive: true, force: true });
  });
});
