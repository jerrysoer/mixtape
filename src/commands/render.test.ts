import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { loadConfig } from "../config.js";
import { grantEnvelope, readEnvelope } from "../render/envelope.js";
import { narratorModel, renderPlan, renderQcFinish, renderRun, totalSpent } from "./render.js";

const root = mkdtempSync(join(tmpdir(), "mx-render-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
// Stills at Dreamina prices with the free voice: with ElevenLabs the first quote is the voice stage (tested below).
const config = loadConfig(root, { MX_VOICE_SOURCE: "say" });
const SAMPLE = readFileSync(new URL("../../fixtures/script.sample.json", import.meta.url), "utf8");

function writeScript(name: string, mutate: (s: Record<string, unknown>) => void = () => undefined): string {
  const s = JSON.parse(SAMPLE) as Record<string, unknown>;
  mutate(s);
  const file = join(root, `${name}.script.json`);
  writeFileSync(file, JSON.stringify(s));
  return file;
}

describe("render (plan + quote)", () => {
  it("refuses a script that fails the originality guard, before writing any plan", async () => {
    const cacheId = "fw1-src-abc123";
    mkdirSync(join(root, ".cache", "break", cacheId), { recursive: true });
    writeFileSync(join(root, ".cache", "break", cacheId, "transcript.json"), JSON.stringify({ text: "By Wednesday the fridge is full and you're ordering takeout again, every week." }));
    const file = writeScript("copied", (s) => {
      (s["structure"] as { source: unknown }).source = { kind: "upload", file_name: "fw1.mp4", cache_id: cacheId };
    });
    await expect(renderPlan(file, { dryRun: false }, root, config)).rejects.toThrow(/render refused[\s\S]*beats\.0\.line: shares 11 words/);
    expect(existsSync(join(root, "renders", "copied"))).toBe(false);
  });

  it("writes plan.json, quote.json and QUOTE.md, and bills nothing", async () => {
    const file = writeScript("plateful");
    const r = await renderPlan(file, { dryRun: false }, root, config);
    const dir = join(root, "renders", "plateful");
    for (const f of ["plan.json", "quote.json", "QUOTE.md"]) expect(existsSync(join(dir, f)), f).toBe(true);
    expect(r.quote.credits).toBe(84);
    expect(existsSync(join(dir, "approval.json"))).toBe(false);
    const md = readFileSync(join(dir, "QUOTE.md"), "utf8");
    expect(md).toContain(r.quote.id);
    expect(md).toContain("sheet_MAYA");
    expect(md).toMatch(/estimate/i);
  });

  it("records an approval only for the matching quote id", async () => {
    const file = writeScript("approve-me");
    const { quote } = await renderPlan(file, { dryRun: false }, root, config);
    await expect(renderPlan(file, { dryRun: false, approve: "q-0000000000" }, root, config)).rejects.toThrow(/does not match/);
    expect(existsSync(join(root, "renders", "approve-me", "approval.json"))).toBe(false);
    await renderPlan(file, { dryRun: false, approve: quote.id }, root, config);
    const approval = JSON.parse(readFileSync(join(root, "renders", "approve-me", "approval.json"), "utf8")) as { quoteId: string; maxCredits: number };
    expect(approval).toMatchObject({ quoteId: quote.id, maxCredits: 84 });
  });

  it("retires an approval when the plan changes (a stale approval can never be used)", async () => {
    const file = writeScript("changes");
    const { quote } = await renderPlan(file, { dryRun: false }, root, config);
    await renderPlan(file, { dryRun: false, approve: quote.id }, root, config);
    // edit the script: new style → new prompts → new quote id
    const s = JSON.parse(readFileSync(file, "utf8")) as { style_lock: { style_prompt: string } };
    s.style_lock.style_prompt = "pencil sketch, 9:16";
    writeFileSync(file, JSON.stringify(s));
    const r = await renderPlan(file, { dryRun: false }, root, config);
    expect(r.quote.id).not.toBe(quote.id);
    const dir = join(root, "renders", "changes");
    expect(existsSync(join(dir, "approval.json"))).toBe(false);
    expect(JSON.parse(readFileSync(join(dir, "approval.stale.json"), "utf8"))).toMatchObject({ quoteId: quote.id });
  });

  it("refuses to approve over the spend ceiling", async () => {
    const file = writeScript("pricey");
    const tight = loadConfig(root, { MX_MAX_SPEND_PER_RUN: "0.5", MX_VOICE_SOURCE: "say" });
    const { quote } = await renderPlan(file, { dryRun: false }, root, tight);
    expect(quote.overCeiling).toBe(true);
    await expect(renderPlan(file, { dryRun: false, approve: quote.id }, root, tight)).rejects.toThrow(/ceiling/);
  });

  it("rejects an unsafe slug", async () => {
    await expect(renderPlan(writeScript("ok"), { dryRun: false, slug: "../../etc" }, root, config)).rejects.toThrow(/slug/);
  });
});

describe.skipIf(!hasSayBin())("retake (fake Dreamina CLI + free say voice)", () => {
  it("after a QC fail, the re-quote charges only the failed shot and the run makes only that node", async () => {
    const fake = join(root, "fake-dreamina.mjs");
    writeFileSync(
      fake,
      `#!/usr/bin/env node
import { appendFileSync, writeFileSync, copyFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
const a = process.argv.slice(2);
appendFileSync(${JSON.stringify(join(root, "dreamina-calls.log"))}, a.slice(0, 2).join(" ") + "\\n");
const val = (f) => a[a.indexOf(f) + 1];
const reply = (data) => process.stdout.write(JSON.stringify({ ok: true, data }));
const [c1, c2] = a;
if (c1 === "canvas") reply({});
else if (c1 === "node" && c2 === "create") reply({});
else if (c1 === "node" && c2 === "quote") reply({ totalMaxCredits: 12 });
else if (c1 === "node" && c2 === "confirm") reply({ creditConfirmationToken: "t" });
else if (c1 === "node" && c2 === "run") reply({});
else if (c1 === "node" && c2 === "show") reply({ nodes: [{ node: { status: "success", resources: [{ resourceId: "r_" + val("--node-id"), status: "success" }] } }] });
else if (c1 === "resource" && (await import("node:fs")).existsSync(val("--output"))) { process.stdout.write(JSON.stringify({ ok: false, error: { code: "cli.invalid_download_output" } })); process.exit(1); }
else if (c1 === "resource") { execFileSync("magick", ["-size", "576x1024", "xc:#6b8f71", val("--output")]); reply({}); }
`,
    );
    execFileSync("chmod", ["755", fake]);
    const cfg = loadConfig(root, { MX_DREAMINA_BIN: fake, MX_VOICE_SOURCE: "say", MX_POLL_SECONDS: "0" });
    const file = writeScript("retake");
    const q1 = (await renderPlan(file, { dryRun: false }, root, cfg)).quote;
    expect(q1.credits).toBe(84);
    await renderPlan(file, { dryRun: false, approve: q1.id }, root, cfg);
    await renderRun(file, {}, root, cfg);
    const dir = join(root, "renders", "retake");
    writeFileSync(join(dir, "qc", "answer.json"), JSON.stringify({ shots: [1, 2, 3, 4, 5].map((n) => ({ id: `shot_0${n}`, frame: n === 4 ? "fail" : "pass", anatomy: "n/a" })) }));
    expect(renderQcFinish(file, {}, root).passed).toBe(false);

    const q2 = (await renderPlan(file, { dryRun: false }, root, cfg)).quote;
    expect(q2.credits).toBe(12);
    expect(q2.items.find((i) => i.label === "on file")?.units).toBe(6);
    await renderPlan(file, { dryRun: false, approve: q2.id }, root, cfg);
    const before = readFileSync(join(root, "dreamina-calls.log"), "utf8").split("\n").filter((l) => l === "node run").length;
    await renderRun(file, {}, root, cfg);
    const after = readFileSync(join(root, "dreamina-calls.log"), "utf8").split("\n").filter((l) => l === "node run").length;
    expect(after - before).toBe(1);
    expect(existsSync(join(dir, `spend-${q1.id}.json`))).toBe(true);
    expect(existsSync(join(dir, `spend-${q2.id}.json`))).toBe(true);
    expect(totalSpent(dir).credits).toBe(96);

    // A planner/style change rewords every prompt; QC-passed shots and the sheet/plate they were
    // built on stay locked, so only the one failed shot would be paid for again.
    writeFileSync(join(dir, "qc", "answer.json"), JSON.stringify({ shots: [1, 2, 3, 4, 5].map((n) => ({ id: `shot_0${n}`, frame: n === 4 ? "fail" : "pass", anatomy: "n/a" })) }));
    renderQcFinish(file, {}, root);
    const s = JSON.parse(readFileSync(file, "utf8")) as { style_lock: { style_prompt: string } };
    s.style_lock.style_prompt = "warm gouache illustration, 9:16";
    writeFileSync(file, JSON.stringify(s));
    const q3 = (await renderPlan(file, { dryRun: false }, root, cfg)).quote;
    expect(q3.credits).toBe(12);
  }, 240_000);
});

describe.skipIf(!hasSayBin())("motion stage (fake Dreamina CLI with Seedance nodes + free say voice)", () => {
  it("quotes clips only after every still is QC-locked, falls a Dreamina-failed clip back to its still, retakes a QC-failed clip once, then keeps the still", async () => {
    const fake = join(root, "fake-dreamina-video.mjs");
    const marks = join(root, "marks");
    mkdirSync(marks, { recursive: true });
    // Video nodes: quote 18 cr/s; a clip's mp4 carries its audio ref (so the sync gate can judge it);
    // marks/fail-<title> fails a node at Dreamina; marks/slow-<title> stretches its speech 1.4x (sync fail).
    writeFileSync(
      fake,
      `#!/usr/bin/env node
import { appendFileSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
const a = process.argv.slice(2);
appendFileSync(${JSON.stringify(join(root, "video-calls.log"))}, a.filter((x) => x !== "--format" && x !== "json" && x !== "--non-interactive").join(" ") + "\\n");
const val = (f) => a[a.indexOf(f) + 1];
const vals = (f) => a.flatMap((x, i) => (x === f ? [a[i + 1]] : []));
const reply = (data) => process.stdout.write(JSON.stringify({ ok: true, data }));
const M = ${JSON.stringify(marks)};
const [c1, c2, c3] = a;
if (c1 === "canvas") reply({});
else if (c1 === "node" && c2 === "create") { writeFileSync(M + "/node-" + val("--node-id"), JSON.stringify({ title: val("--title"), dur: c3 === "video" ? Number(val("--duration")) : 0, refs: vals("--ref") })); reply({}); }
else if (c1 === "node" && c2 === "quote") { const n = JSON.parse(readFileSync(M + "/node-" + val("--node-id"), "utf8")); reply({ totalMaxCredits: n.dur ? n.dur * 18 : 12 }); }
else if (c1 === "node" && c2 === "confirm") reply({ creditConfirmationToken: "t" });
else if (c1 === "node" && c2 === "run") reply({});
else if (c1 === "node" && c2 === "show") { const n = JSON.parse(readFileSync(M + "/node-" + val("--node-id"), "utf8")); const bad = existsSync(M + "/fail-" + n.title.split(" ").pop()); reply({ nodes: [{ node: { status: bad ? "failed" : "success", resources: [{ resourceId: "r_" + val("--node-id"), status: bad ? "failed" : "success", errorCode: bad ? 20008 : undefined }] } }] }); }
else if (c1 === "resource" && c2 === "upload") { const id = "up_" + val("--type") + "_" + val("--resource-id").slice(0, 8); writeFileSync(M + "/res-" + id, val("--file")); reply({ resourceId: id }); }
else if (c1 === "resource" && existsSync(val("--output"))) { process.stdout.write(JSON.stringify({ ok: false, error: { code: "cli.invalid_download_output" } })); process.exit(1); }
else if (c1 === "resource" && val("--output").endsWith(".mp4")) {
  const n = JSON.parse(readFileSync(M + "/node-" + a[2].replace(/^r_/, ""), "utf8"));
  const audioRef = n.refs.map((r) => r.replace(/^res:/, "")).find((r) => r.startsWith("up_audio"));
  const audio = audioRef ? readFileSync(M + "/res-" + audioRef, "utf8") : null;
  const slow = existsSync(M + "/slow-" + n.title.split(" ").pop());
  const args = ["-hide_banner", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "color=c=0x6b8f71:s=720x1280:r=24"];
  if (audio) args.push("-i", audio, "-af", slow ? "atempo=0.7,apad" : "apad", "-t", String(n.dur), "-c:a", "aac"); else args.push("-t", "1");
  args.push("-pix_fmt", "yuv420p", val("--output"));
  execFileSync("ffmpeg", args); reply({});
}
else if (c1 === "resource") { execFileSync("magick", ["-size", "576x1024", "xc:#6b8f71", val("--output")]); reply({}); }
`,
    );
    execFileSync("chmod", ["755", fake]);
    const cfg = loadConfig(root, { MX_DREAMINA_BIN: fake, MX_VOICE_SOURCE: "say", MX_POLL_SECONDS: "0" });
    // MAYA says the PROBLEM line on camera: that clip lip-syncs to her recorded line (rule 0).
    const file = writeScript("motion-paid", (s) => {
      const beat = (s["beats"] as { shot: Record<string, unknown> }[])[0];
      if (beat) beat.shot = { ...beat.shot, speaker: "MAYA", motion: "slow push in; she glances at the fridge" };
    });
    const dir = join(root, "renders", "motion-paid");
    const runs = () => (existsSync(join(root, "video-calls.log")) ? readFileSync(join(root, "video-calls.log"), "utf8").split("\n").filter((l) => l.startsWith("node run")).length : 0);

    // 1. stills stage: same quote as a still render; the plan says the clips come after QC
    const p1 = await renderPlan(file, { dryRun: false }, root, cfg);
    expect(p1.plan).toMatchObject({ mode: "motion", stage: "stills" });
    expect(p1.quote.credits).toBe(84);
    await renderPlan(file, { dryRun: false, approve: p1.quote.id }, root, cfg);
    const r1 = await renderRun(file, {}, root, cfg);
    expect(r1.stage).toBe("stills");
    // still locked? not yet: a stills QC fail keeps the stage at stills
    writeFileSync(join(dir, "qc", "answer.json"), JSON.stringify({ shots: [1, 2, 3, 4, 5].map((n) => ({ id: `shot_0${n}`, frame: n === 2 ? "fail" : "pass", anatomy: "n/a" })) }));
    expect(renderQcFinish(file, {}, root)).toMatchObject({ passed: false, stage: "stills" });
    expect((await renderPlan(file, { dryRun: false }, root, cfg)).plan.stage).toBe("stills");
    writeFileSync(join(dir, "qc", "answer.json"), JSON.stringify({ shots: [1, 2, 3, 4, 5].map((n) => ({ id: `shot_0${n}`, frame: "pass", anatomy: "n/a" })) }));
    expect(renderQcFinish(file, {}, root)).toMatchObject({ passed: true, stage: "stills", mode: "motion" });

    // 2. clip stage: one clip per shot on top of the locked stills, priced per second; --still stays at stills
    expect((await renderPlan(file, { dryRun: false, still: true }, root, cfg)).plan.stage).toBe("stills");
    const p2 = await renderPlan(file, { dryRun: false }, root, cfg);
    expect(p2.plan.stage).toBe("clips");
    expect(p2.plan.clips).toHaveLength(5);
    const secs = p2.plan.clips.reduce((a, c) => a + c.seconds, 0);
    expect(p2.quote.credits).toBe(secs * 18);
    expect(p2.quote.items.find((i) => i.label === "on file")?.units).toBe(7);
    expect(p2.quote.id).not.toBe(p1.quote.id);
    // the speaking clip carries a tight audio ref and the rule-0 lips line
    const talking = p2.plan.clips.find((c) => c.id === "clip_02");
    expect(talking?.speaker).toBe("MAYA");
    expect(talking?.audio).toMatch(/voice\/refs\/clip_02\.wav$/);
    expect(talking?.prompt).toContain("Lips follow {{audio}} exactly");
    expect(p2.plan.clips.find((c) => c.id === "clip_01")?.audio).toBeUndefined();
    await renderPlan(file, { dryRun: false, approve: p2.quote.id }, root, cfg);
    writeFileSync(join(marks, "fail-clip_04"), "1"); // Dreamina fails this clip: its shot keeps the still, delivery goes on
    writeFileSync(join(marks, "slow-clip_02"), "1"); // Seedance re-times the line 1.4x: the sync gate fails it, still fallback
    const before = runs();
    const r2 = await renderRun(file, {}, root, cfg);
    expect(runs() - before).toBe(5);
    expect(r2).toMatchObject({ stage: "clips", stillShots: [2, 4] });
    expect(r2.spent.credits).toBe(secs * 18);
    const log = readFileSync(join(root, "video-calls.log"), "utf8");
    expect(log).toMatch(/resource upload .* --type audio/);
    const createTalking = log.split("\n").find((l) => l.includes("node create video") && l.includes("clip_02")) ?? "";
    expect(createTalking).toMatch(/Lips follow \{\{res:up_audio_[0-9a-f]+\}\} exactly/);
    expect(createTalking.match(/--ref res:/g)).toHaveLength(2);
    const sync = JSON.parse(readFileSync(join(dir, "clips-sync.json"), "utf8")) as Record<string, { pass: boolean; ratio: number }>;
    expect(sync["clip_02"]?.pass).toBe(false);
    expect(sync["clip_02"]?.ratio ?? 0).toBeGreaterThan(1.18);
    expect(readFileSync(r2.qcPrompt, "utf8")).toContain("clip_05");
    expect(readFileSync(r2.qcPrompt, "utf8")).toContain("fell back to the still");
    for (const n of [1, 3, 5]) expect(existsSync(join(dir, "clips", `clip_0${n}.mp4`))).toBe(true);
    expect(totalSpent(dir).credits).toBe(84 + secs * 18);
    rmSync(join(marks, "fail-clip_04"), { force: true });
    rmSync(join(marks, "slow-clip_02"), { force: true });

    // 3. clip QC: a stills-style answer is refused; the sync-failed and Dreamina-failed clips are re-quoted alone
    writeFileSync(join(dir, "qc", "answer.json"), JSON.stringify({ shots: [{ id: "shot_01", frame: "pass", anatomy: "n/a" }] }));
    expect(() => renderQcFinish(file, {}, root)).toThrow(/clip stage/);
    const clipAnswer = (fail: number[], ids = [1, 2, 3, 4, 5]) => ({ shots: ids.map((n) => ({ id: `clip_0${n}`, frame: "pass", anatomy: "n/a", motion: fail.includes(n) ? "fail" : "pass", lips: "n/a", note: "" })) });
    writeFileSync(join(dir, "qc", "answer.json"), JSON.stringify(clipAnswer([], [1, 3, 5])));
    expect(renderQcFinish(file, {}, root)).toMatchObject({ passed: false, stage: "clips", failures: ["clip_02: no verdict yet", "clip_04: no verdict yet"] });
    const p3 = await renderPlan(file, { dryRun: false }, root, cfg);
    const retake = p3.plan.clips.filter((c) => c.id === "clip_02" || c.id === "clip_04");
    expect(p3.quote.credits).toBe(retake.reduce((a, c) => a + c.seconds, 0) * 18);
    expect(p3.quote.items.find((i) => i.label === "clips on file")?.units).toBe(3);
    await renderPlan(file, { dryRun: false, approve: p3.quote.id }, root, cfg);
    const b3 = runs();
    const r3 = await renderRun(file, {}, root, cfg);
    expect(runs() - b3).toBe(2);
    expect(r3.stillShots).toEqual([]);
    const sync3 = JSON.parse(readFileSync(join(dir, "clips-sync.json"), "utf8")) as Record<string, { pass: boolean; ratio: number; speed?: number }>;
    expect(sync3["clip_02"]?.pass).toBe(true);
    expect(sync3["clip_02"]?.ratio ?? 0).toBeGreaterThan(0.85);

    // 4. the retake fails QC too (one sync retake already used): clip_02 keeps its still at 0 cr; the rest is on file; delivered
    writeFileSync(join(dir, "qc", "answer.json"), JSON.stringify(clipAnswer([2])));
    expect(renderQcFinish(file, {}, root).passed).toBe(false);
    const p4 = await renderPlan(file, { dryRun: false }, root, cfg);
    expect(p4.plan.clips.map((c) => c.id)).toEqual(["clip_01", "clip_03", "clip_04", "clip_05"]);
    expect(p4.quote.credits).toBe(0);
    await renderPlan(file, { dryRun: false, approve: p4.quote.id }, root, cfg);
    const b4 = runs();
    const r4 = await renderRun(file, {}, root, cfg);
    expect(runs() - b4).toBe(0);
    expect(r4.stillShots).toEqual([2]);
    writeFileSync(join(dir, "qc", "answer.json"), JSON.stringify({ shots: [1, 3, 4, 5].map((n) => ({ id: `clip_0${n}`, frame: "pass", anatomy: "n/a", motion: "pass", lips: "n/a" })) }));
    expect(renderQcFinish(file, {}, root)).toMatchObject({ passed: true, stage: "clips" });
    const probe = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-print_format", "json", "-show_streams", r4.out], { encoding: "utf8" })) as { streams: { codec_type: string; width?: number; height?: number; sample_aspect_ratio?: string }[] };
    expect(probe.streams.find((s) => s.codec_type === "video")).toMatchObject({ width: 1080, height: 1920 });
  }, 600_000);
});

describe.skipIf(!hasSayBin())("resume (fake Dreamina CLI)", () => {
  it("a run that hands back while a paid still is rendering resumes later with no new approval and no second run", async () => {
    const fake = join(root, "fake-dreamina-slow.mjs");
    const marks = join(root, "marks-slow");
    mkdirSync(marks, { recursive: true });
    writeFileSync(
      fake,
      `#!/usr/bin/env node
import { appendFileSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
const a = process.argv.slice(2);
appendFileSync(${JSON.stringify(join(root, "slow-calls.log"))}, a.slice(0, 2).join(" ") + "\\n");
const val = (f) => a[a.indexOf(f) + 1];
const reply = (data) => process.stdout.write(JSON.stringify({ ok: true, data }));
const M = ${JSON.stringify(marks)};
const [c1, c2] = a;
if (c1 === "canvas") reply({});
else if (c1 === "node" && c2 === "create") { writeFileSync(M + "/node-" + val("--node-id"), val("--title")); reply({}); }
else if (c1 === "node" && c2 === "quote") reply({ totalMaxCredits: 12 });
else if (c1 === "node" && c2 === "confirm") reply({ creditConfirmationToken: "t" });
else if (c1 === "node" && c2 === "run") reply({});
else if (c1 === "node" && c2 === "show") { const title = readFileSync(M + "/node-" + val("--node-id"), "utf8"); const slow = existsSync(M + "/wait-" + title.split(" ").pop()); reply({ nodes: [{ node: { status: slow ? "running" : "success", resources: slow ? [] : [{ resourceId: "r_" + val("--node-id"), status: "success" }] } }] }); }
else if (c1 === "resource" && existsSync(val("--output"))) { process.stdout.write(JSON.stringify({ ok: false, error: { code: "cli.invalid_download_output" } })); process.exit(1); }
else if (c1 === "resource") { execFileSync("magick", ["-size", "576x1024", "xc:#6b8f71", val("--output")]); reply({}); }
`,
    );
    execFileSync("chmod", ["755", fake]);
    const cfg = loadConfig(root, { MX_DREAMINA_BIN: fake, MX_VOICE_SOURCE: "say", MX_POLL_SECONDS: "0", MX_WAIT_TIMEOUT_SECONDS: "1", MX_RENDER_MODE: "still" });
    const file = writeScript("slow");
    const dir = join(root, "renders", "slow");
    const runs = () => readFileSync(join(root, "slow-calls.log"), "utf8").split("\n").filter((l) => l === "node run").length;
    const q1 = (await renderPlan(file, { dryRun: false }, root, cfg)).quote;
    await renderPlan(file, { dryRun: false, approve: q1.id }, root, cfg);
    writeFileSync(join(marks, "wait-shot_03"), "1"); // Dreamina is slow on this one
    await expect(renderRun(file, {}, root, cfg)).rejects.toThrow(/Still waiting on shot_03/);
    expect(runs()).toBe(7);
    expect(totalSpent(dir).credits).toBe(84);
    // The re-plan bills nothing: the pending still is paid for, so it is "on file" and needs no new approval.
    const q2 = (await renderPlan(file, { dryRun: false }, root, cfg)).quote;
    expect(q2.credits).toBe(0);
    expect(q2.items.find((i) => i.label === "on file")?.units).toBe(7);
    expect(existsSync(join(dir, "approval.json"))).toBe(false);
    rmSync(join(marks, "wait-shot_03"), { force: true });
    const r = await renderRun(file, {}, root, cfg);
    expect(runs()).toBe(7);
    expect(existsSync(join(dir, "stills", "shot_03.png"))).toBe(true);
    expect(r.stage).toBe("stills");
    expect(totalSpent(dir).credits).toBe(84);
  }, 240_000);
});

function hasSayBin(): boolean {
  try {
    execFileSync("say", ["-v", "?"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

describe("render --run gate", () => {
  it("refuses to run without an approval matching the current quote, and spends nothing", async () => {
    const file = writeScript("unapproved");
    await expect(renderRun(file, {}, root, config)).rejects.toThrow(/No approval for quote q-/);
    expect(existsSync(join(root, "renders", "unapproved", "spend.json"))).toBe(false);
  });

  it("an envelope too small for the quote approves nothing and says what is left", async () => {
    const file = writeScript("small-envelope");
    await renderPlan(file, { dryRun: false }, root, config);
    const dir = join(root, "renders", "small-envelope");
    grantEnvelope(dir, { credits: 50, usd: 0 });
    await expect(renderRun(file, {}, root, config)).rejects.toThrow(/No approval[\s\S]*Envelope: the quote \(84 cr, \$0\.00 narration\) is more than the envelope has left \(50 cr, \$0\.00\)/);
    expect(existsSync(join(dir, "approval.json"))).toBe(false);
    expect(readEnvelope(dir)?.approved).toEqual([]);
  });
});

describe.skipIf(!hasSayBin())("envelope approval (fake Dreamina CLI + free say voice)", () => {
  it("--run approves each quote out of the envelope while it fits, writes approval.json and the ledger, then stops when it is spent", async () => {
    const fake = join(root, "fake-dreamina-env.mjs");
    writeFileSync(
      fake,
      `#!/usr/bin/env node
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
const a = process.argv.slice(2);
const val = (f) => a[a.indexOf(f) + 1];
const reply = (data) => process.stdout.write(JSON.stringify({ ok: true, data }));
const [c1, c2] = a;
if (c1 === "canvas") reply({});
else if (c1 === "node" && c2 === "create") reply({});
else if (c1 === "node" && c2 === "quote") reply({ totalMaxCredits: 12 });
else if (c1 === "node" && c2 === "confirm") reply({ creditConfirmationToken: "t" });
else if (c1 === "node" && c2 === "run") reply({});
else if (c1 === "node" && c2 === "show") reply({ nodes: [{ node: { status: "success", resources: [{ resourceId: "r_" + val("--node-id"), status: "success" }] } }] });
else if (c1 === "resource" && existsSync(val("--output"))) { process.stdout.write(JSON.stringify({ ok: false, error: { code: "cli.invalid_download_output" } })); process.exit(1); }
else if (c1 === "resource") { execFileSync("magick", ["-size", "576x1024", "xc:#6b8f71", val("--output")]); reply({}); }
`,
    );
    execFileSync("chmod", ["755", fake]);
    const cfg = loadConfig(root, { MX_DREAMINA_BIN: fake, MX_VOICE_SOURCE: "say", MX_POLL_SECONDS: "0", MX_RENDER_MODE: "still" });
    const file = writeScript("enveloped");
    const dir = join(root, "renders", "enveloped");
    const q1 = (await renderPlan(file, { dryRun: false }, root, cfg)).quote;
    expect(q1.credits).toBe(84);
    // 90 cr covers the 84 cr stills quote but not a 12 cr retake after that
    grantEnvelope(dir, { credits: 90, usd: 0 });
    const r1 = await renderRun(file, {}, root, cfg);
    expect(r1.stage).toBe("stills");
    expect(JSON.parse(readFileSync(join(dir, "approval.json"), "utf8"))).toMatchObject({ quoteId: q1.id, maxCredits: 84, envelope: true });
    expect(totalSpent(dir).credits).toBe(84);
    expect(readEnvelope(dir)?.approved.map((a) => [a.quoteId, a.credits])).toEqual([[q1.id, 84]]);
    // the run also cut the shots to the recorded read: the next plan carries read_s and the shots' windows follow it
    const p2 = await renderPlan(file, { dryRun: false }, root, cfg);
    expect(p2.plan.read_s).toBeGreaterThan(5);
    expect(p2.plan.duration_s).toBe(p2.plan.read_s);
    expect(p2.plan.target_s).toBe(24);
    expect(p2.plan.shots.at(-1)?.t_target[1]).toBe(p2.plan.read_s);
    expect(readFileSync(join(dir, "QUOTE.md"), "utf8")).toMatch(/s \(the recorded read; script target 24 s\)/);
    // a QC fail → 12 cr retake quote: 6 cr left in the envelope, so the run refuses and bills nothing more
    writeFileSync(join(dir, "qc", "answer.json"), JSON.stringify({ shots: [1, 2, 3, 4, 5].map((n) => ({ id: `shot_0${n}`, frame: n === 3 ? "fail" : "pass", anatomy: "n/a" })) }));
    renderQcFinish(file, {}, root);
    const q2 = (await renderPlan(file, { dryRun: false }, root, cfg)).quote;
    expect(q2.credits).toBe(12);
    await expect(renderRun(file, {}, root, cfg)).rejects.toThrow(/more than the envelope has left \(6 cr/);
    expect(totalSpent(dir).credits).toBe(84);
  }, 240_000);
});

const hasSay = (() => {
  try {
    execFileSync("say", ["-v", "?"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

describe("voice first (ElevenLabs narration before any still)", () => {
  it("quotes the narration alone, with the delivery tag's characters, until the one take is on file", async () => {
    const vroot = mkdtempSync(join(tmpdir(), "mx-voice-first-"));
    mkdirSync(join(vroot, "renders"), { recursive: true });
    writeFileSync(join(vroot, "renders", "account.json"), JSON.stringify({ narrator: { provider: "elevenlabs", model: "eleven_v3", model_motion: "eleven_v4", voice_id: "abcdefghijkl", delivery_tag: "[casual]" } }));
    const s = JSON.parse(SAMPLE) as Record<string, unknown>;
    const file = join(vroot, "voice-ad.script.json");
    writeFileSync(file, JSON.stringify(s));
    const cfg = loadConfig(vroot, { MX_VOICE_SOURCE: "elevenlabs", ELEVENLABS_API_KEY: "k", MX_IMAGE_SOURCE: "placeholder", MX_VIDEO_SOURCE: "placeholder" });
    const r = await renderPlan(file, { dryRun: false }, vroot, cfg);
    expect(r.plan.stage).toBe("voice");
    expect(r.quote.items.map((i) => i.label)).toEqual(["narration"]);
    expect(r.quote.credits).toBe(0);
    expect(r.quote.items[0]?.units).toBe(r.plan.voice.text.length + "[casual] ".length);
    expect(r.dryRun).toBeNull();
    // the take lands in the cache (any seed) → the next plan is the stills stage, nothing for the voice
    const { takeBody, takeKey, takeText } = await import("../providers/voice/record.js");
    const key = takeKey("abcdefghijkl", "eleven_v4", takeBody(takeText(r.plan.shots.map((x) => ({ text: x.vo }))), "[casual]"), 1);
    mkdirSync(join(vroot, "renders", "voice-ad", "voice", "cache"), { recursive: true });
    writeFileSync(join(vroot, "renders", "voice-ad", "voice", "cache", `${key}.mp3`), "");
    const r2 = await renderPlan(file, { dryRun: false }, vroot, cfg);
    expect(r2.plan.stage).toBe("stills");
    expect(r2.quote.items.map((i) => i.label)).not.toContain("narration");
    // a register tag in the script (press --register) replaces the account's tag: a different take, so the voice stage again
    (s["audio"] as Record<string, unknown>)["delivery_tag"] = "[quiet, confiding]";
    writeFileSync(file, JSON.stringify(s));
    const r3 = await renderPlan(file, { dryRun: false }, vroot, cfg);
    expect(r3.plan.stage).toBe("voice");
    expect(r3.plan.voice.tag).toBe("[quiet, confiding]");
    expect(r3.quote.items[0]?.units).toBe(r.plan.voice.text.length + "[quiet, confiding] ".length);
    rmSync(vroot, { recursive: true, force: true });
  });
});

describe.skipIf(!hasSay)("voice dry run (macOS say)", () => {
  it("records the narration for free and reports its length against the target", async () => {
    const r = await renderPlan(writeScript("dry"), { dryRun: true }, root, config);
    expect(existsSync(join(root, "renders", "dry", "dryrun", "vo.aiff"))).toBe(true);
    expect(r.dryRun?.seconds).toBeGreaterThan(5);
    expect(r.dryRun?.wordsPerSecond).toBeGreaterThan(1);
    expect(r.dryRun?.targetSeconds).toBe(24);
    expect(r.dryRun).not.toHaveProperty("withinPct"); // say's pace is no timing verdict
  }, 30_000);

  it("free motion end to end: placeholder stills → QC → placeholder clips → motion cut, with the voice model per mode", async () => {
    const free = loadConfig(root, { MX_IMAGE_SOURCE: "placeholder", MX_VIDEO_SOURCE: "placeholder", MX_VOICE_SOURCE: "say" });
    const file = writeScript("free-motion");
    const dir = join(root, "renders", "free-motion");
    const p1 = await renderPlan(file, { dryRun: false }, root, free);
    expect(p1.plan.stage).toBe("stills");
    await renderPlan(file, { dryRun: false, approve: p1.quote.id }, root, free);
    await renderRun(file, {}, root, free);
    writeFileSync(join(dir, "qc", "answer.json"), JSON.stringify({ shots: [1, 2, 3, 4, 5].map((n) => ({ id: `shot_0${n}`, frame: "pass", anatomy: "n/a" })) }));
    expect(renderQcFinish(file, {}, root)).toMatchObject({ passed: true, stage: "stills", mode: "motion" });
    const p2 = await renderPlan(file, { dryRun: false }, root, free);
    expect(p2.plan.stage).toBe("clips");
    expect(p2.quote.usd).toBe(0);
    await renderPlan(file, { dryRun: false, approve: p2.quote.id }, root, free);
    const r = await renderRun(file, {}, root, free);
    expect(r).toMatchObject({ stage: "clips", stillShots: [] });
    expect(JSON.parse(readFileSync(join(dir, "render.json"), "utf8"))).toMatchObject({ mode: "motion", stage: "clips", video: "placeholder" });
    // the narrator model follows the mode (v4 or later for motion, the still model for --still)
    const account = { narrator: { provider: "elevenlabs" as const, model: "eleven_v3", model_motion: "eleven_v4", voice_id: "abcdefghijkl", words_per_second: {} }, captions: { font: "f", words_per_chunk: 3 } };
    expect(narratorModel(account, "motion")).toBe("eleven_v4");
    expect(narratorModel(account, "still")).toBe("eleven_v3");
    expect(existsSync(join(dir, "clips", "clip_05.mp4"))).toBe(true);
    // the cut's segments came from the clips (1080x1920, square pixels)
    const probe = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-print_format", "json", "-show_streams", join(dir, "build", "seg_01.mp4")], { encoding: "utf8" })) as { streams: { width?: number; height?: number; sample_aspect_ratio?: string }[] };
    expect(probe.streams[0]).toMatchObject({ width: 1080, height: 1920 });
    expect(probe.streams[0]?.sample_aspect_ratio ?? "1:1").toBe("1:1");
    writeFileSync(join(dir, "qc", "answer.json"), JSON.stringify({ shots: [1, 2, 3, 4, 5].map((n) => ({ id: `clip_0${n}`, frame: "pass", anatomy: "n/a", motion: "pass", lips: "n/a" })) }));
    expect(renderQcFinish(file, {}, root)).toMatchObject({ passed: true, stage: "clips" });
    // --still on the same render: stills stage, still-mode voice model
    const still = await renderPlan(file, { dryRun: false, still: true }, root, free);
    expect(still.plan).toMatchObject({ mode: "still", stage: "stills" });
  }, 300_000);

  it("free end to end: placeholder stills + say narration → 1080x1920 MP4, QC prompt, QC verdicts", async () => {
    const free = loadConfig(root, { MX_IMAGE_SOURCE: "placeholder", MX_VOICE_SOURCE: "say", MX_RENDER_MODE: "still" });
    const file = writeScript("free-run");
    const { quote } = await renderPlan(file, { dryRun: false }, root, free);
    expect(quote.usd).toBe(0);
    await renderPlan(file, { dryRun: false, approve: quote.id }, root, free);
    const r = await renderRun(file, {}, root, free);
    const probe = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-print_format", "json", "-show_streams", r.out], { encoding: "utf8" })) as { streams: { codec_type: string; width?: number; height?: number }[] };
    expect(probe.streams.find((s) => s.codec_type === "video")).toMatchObject({ width: 1080, height: 1920 });
    expect(probe.streams.some((s) => s.codec_type === "audio")).toBe(true);
    expect(readFileSync(r.qcPrompt, "utf8")).toContain("shot_05");

    const dir = join(root, "renders", "free-run");
    const verdicts = (fail: boolean) => ({ shots: [1, 2, 3, 4, 5].map((n) => ({ id: `shot_0${n}`, frame: fail && n === 2 ? "fail" : "pass", anatomy: n === 2 ? "pass" : "n/a", note: "" })) });
    writeFileSync(join(dir, "qc", "answer.json"), JSON.stringify(verdicts(true)));
    expect(renderQcFinish(file, {}, root)).toMatchObject({ passed: false, failures: ["shot_02: frame fail"] });
    writeFileSync(join(dir, "qc", "answer.json"), JSON.stringify(verdicts(false)));
    expect(renderQcFinish(file, {}, root).passed).toBe(true);
    expect(JSON.parse(readFileSync(join(dir, "qc.json"), "utf8"))).toMatchObject({ passed: true });
  }, 180_000);
});
