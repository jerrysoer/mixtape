import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { Budget } from "../../render/budget.js";
import type { ApprovalToken } from "../../render/quote.js";
import { Dreamina } from "./dreamina.js";

const dir = mkdtempSync(join(tmpdir(), "mx-dreamina-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** A fake dreamina-canvas: logs every call, quotes 12 cr, finishes nodes on the first show. */
const fake = join(dir, "fake-dreamina.mjs");
writeFileSync(
  fake,
  `#!/usr/bin/env node
import { appendFileSync, writeFileSync } from "node:fs";
const a = process.argv.slice(2);
appendFileSync(${JSON.stringify(join(dir, "calls.log"))}, a.filter((x) => x !== "--format" && x !== "json" && x !== "--non-interactive").join(" ") + "\\n");
const val = (f) => a[a.indexOf(f) + 1];
const reply = (data) => process.stdout.write(JSON.stringify({ ok: true, data }));
const [c1, c2] = a;
if (c1 === "canvas") reply({ projectId: val("--project-id") });
else if (c1 === "node" && c2 === "create") reply({ nodeId: val("--node-id") });
else if (c1 === "node" && c2 === "quote") reply({ totalMaxCredits: 12 });
else if (c1 === "node" && c2 === "confirm") reply({ creditConfirmationToken: "tok-" + val("--node-id") });
else if (c1 === "node" && c2 === "run") reply({});
else if (c1 === "node" && c2 === "show") { const { existsSync } = await import("node:fs"); const bad = existsSync(${JSON.stringify(dir)} + "/fail-" + val("--node-id")); reply({ nodes: [{ node: { status: bad ? "failed" : "success", resources: [{ resourceId: "res_" + val("--node-id"), status: bad ? "failed" : "success", errorCode: bad ? 20008 : undefined }] } }] }); }
else if (c1 === "resource" && c2 === "upload") reply({ resourceId: "up_" + val("--type") + "_" + val("--resource-id").slice(0, 8) });
else if (c1 === "resource" && (await import("node:fs")).existsSync(val("--output"))) { process.stdout.write(JSON.stringify({ ok: false, error: { code: "cli.invalid_download_output" } })); process.exit(1); }
else if (c1 === "resource") { writeFileSync(val("--output"), "png"); reply({}); }
else { process.stdout.write(JSON.stringify({ ok: false, error: { code: "unknown" } })); }
`,
);
chmodSync(fake, 0o755);

const calls = () => readFileSync(join(dir, "calls.log"), "utf8").trim().split("\n");
const token = (maxCredits: number) => ({ quoteId: "q-dream00000", maxCredits, maxUsd: 10 }) as ApprovalToken;
const sheet = { id: "sheet_MAYA", kind: "sheet" as const, prompt: "sheet prompt", refs: [] as string[], hash: "h-sheet-1" };
const shot = { id: "shot_01", kind: "shot" as const, prompt: "shot prompt", refs: ["sheet_MAYA"], hash: "h-shot-1" };

describe("Dreamina provider (fake CLI)", () => {
  it("saves nodes with upstream node refs, quotes, runs one node per call and downloads", async () => {
    const d = new Dreamina({ dir, bin: fake, pollSeconds: 0 });
    await d.ensureProject("test");
    await d.saveNode(sheet, "test");
    await d.saveNode(shot, "test");
    const sheetNode = d.state.nodes["sheet_MAYA"]?.nodeId ?? "";
    const create = calls().find((c) => c.includes("node create image") && c.includes("shot_01")) ?? "";
    expect(create).toContain(`--ref node:${sheetNode}`);
    expect(create).toContain("--mode i2i");
    expect(create).toContain(`{{node:${sheetNode}}} (sheet_MAYA)`);
    expect(await d.quote("shot_01")).toBe(12);

    const budget = Budget.open(join(dir, "spend.json"), token(24), 113);
    await d.run("sheet_MAYA", budget);
    await d.run("shot_01", budget);
    expect(calls().filter((c) => c.startsWith("node run"))).toHaveLength(2);
    expect(budget.spent.credits).toBe(24);
    const files = await d.waitAndFetch(["sheet_MAYA", "shot_01"]);
    expect(existsSync(files["shot_01"] ?? "")).toBe(true);
  });

  it("never runs (or saves twice) a node already accepted, after a restart", async () => {
    const before = calls().length;
    const d = new Dreamina({ dir, bin: fake, pollSeconds: 0 });
    await d.saveNode(shot, "test");
    await d.run("shot_01", Budget.open(join(dir, "spend.json"), token(24), 113));
    expect(calls().length).toBe(before);
  });

  it("never caches a 0 quote (shots quote 0 until their refs exist) and re-quotes before running", async () => {
    const zdir = mkdtempSync(join(tmpdir(), "mx-dreamina-z-"));
    const zfake = join(zdir, "zero.mjs");
    // quotes 0 the first time a node is asked, 12 after that
    writeFileSync(
      zfake,
      readFileSync(fake, "utf8").replace(
        'else if (c1 === "node" && c2 === "quote") reply({ totalMaxCredits: 12 });',
        `else if (c1 === "node" && c2 === "quote") { const f = ${JSON.stringify(join(zdir, "asked"))} + val("--node-id"); const { existsSync } = await import("node:fs"); if (existsSync(f)) reply({ totalMaxCredits: 12 }); else { writeFileSync(f, "1"); reply({ totalMaxCredits: 0 }); } }`,
      ),
    );
    chmodSync(zfake, 0o755);
    const d = new Dreamina({ dir: zdir, bin: zfake, pollSeconds: 0 });
    await d.ensureProject("z");
    await d.saveNode(shot, "z");
    expect(await d.quote("shot_01")).toBe(0);
    expect(d.state.nodes["shot_01"]?.quote).toBeUndefined();
    const budget = Budget.open(join(zdir, "spend.json"), token(24), 113);
    await d.run("shot_01", budget);
    expect(budget.spent.credits).toBe(12);
    rmSync(zdir, { recursive: true, force: true });
  });

  it("a changed prompt (new hash) gets a fresh node; the old one is archived, never reused", async () => {
    const d = new Dreamina({ dir, bin: fake, pollSeconds: 0 });
    const oldNode = d.state.nodes["shot_01"]?.nodeId;
    expect(d.reusable({ ...shot }, false)).toBe(true);
    const changed = { ...shot, prompt: "shot prompt, now with a wall calendar", hash: "h-shot-2" };
    expect(d.reusable(changed, false)).toBe(false);
    expect(d.reusable(changed, true)).toBe(true); // QC-locked: kept even though the planner's wording changed
    await d.saveNode(changed, "test");
    expect(d.state.nodes["shot_01"]?.nodeId).not.toBe(oldNode);
    expect(d.state.history?.some((h) => h.id === "shot_01" && h.nodeId === oldNode)).toBe(true);
  });

  it("keeps waiting past a failed node, downloads the rest, then reports the failure", async () => {
    const fdir = mkdtempSync(join(tmpdir(), "mx-dreamina-f-"));
    const d = new Dreamina({ dir: fdir, bin: fake, pollSeconds: 0 });
    await d.ensureProject("f");
    const a = { ...sheet, id: "shot_02", hash: "a" };
    const b = { ...sheet, id: "shot_03", hash: "b" };
    await d.saveNode(a, "f");
    await d.saveNode(b, "f");
    const budget = Budget.open(join(fdir, "spend.json"), token(24), 113);
    await d.run("shot_02", budget);
    await d.run("shot_03", budget);
    writeFileSync(join(dir, `fail-${d.state.nodes["shot_02"]?.nodeId ?? ""}`), "1");
    await expect(d.waitAndFetch(["shot_02", "shot_03"])).rejects.toThrow(/shot_02 \(error 20008\)/);
    expect(existsSync(d.state.nodes["shot_03"]?.file ?? "")).toBe(true);
    // a failed node is retaken as a fresh node
    expect(d.reusable(a, false)).toBe(false);
    rmSync(fdir, { recursive: true, force: true });
  });

  it("makes a Seedance clip node from an uploaded locked still (m2v, first frame, never --run on create) and downloads an mp4", async () => {
    const cdir = mkdtempSync(join(tmpdir(), "mx-dreamina-clip-"));
    const d = new Dreamina({ dir: cdir, bin: fake, pollSeconds: 0, videoResolution: "720p" });
    await d.ensureProject("clips");
    const still = join(cdir, "shot_01.png");
    writeFileSync(still, "png-bytes");
    const clip = { id: "clip_01", still: "shot_01", shot: 1, seconds: 5, model: "seedance_2.5", prompt: "She lifts the box.", speaker: null, hash: "c1", base: "b1" };
    await d.saveClipNode(clip, "clips", still);
    const create = calls().find((c) => c.includes("node create video") && c.includes("clip_01")) ?? "";
    expect(create).toContain("--mode m2v");
    expect(create).toContain("--model seedance_2.5");
    expect(create).toContain("--duration 5");
    expect(create).toContain("--resolution 720p");
    expect(create).toMatch(/--ref res:up_image_/);
    expect(create).toMatch(/First frame: \{\{res:up_image_[0-9a-f]+\}\} \(shot_01\)\. She lifts the box\./);
    expect(create).not.toContain("--run");
    // the same still bytes upload once
    expect(await d.upload(still, "image")).toBe(await d.upload(still, "image"));
    expect(calls().filter((c) => c.startsWith("resource upload"))).toHaveLength(1);
    const budget = Budget.open(join(cdir, "spend.json"), token(12), 113);
    await d.run("clip_01", budget);
    expect(d.state.nodes["clip_01"]?.kind).toBe("clip");
    const files = await d.waitAndFetch(["clip_01"]);
    expect(files["clip_01"]).toMatch(/clips\/clip_01\.mp4$/);
    expect(d.qcRetakes("clip_01")).toBe(0);
    d.retire("clip_01", "QC fail");
    expect(d.qcRetakes("clip_01")).toBe(1);
    rmSync(cdir, { recursive: true, force: true });
  });

  it("stops before confirming a node that would pass the approved credits", async () => {
    const d2dir = mkdtempSync(join(tmpdir(), "mx-dreamina2-"));
    const d = new Dreamina({ dir: d2dir, bin: fake, pollSeconds: 0 });
    await d.ensureProject("t2");
    await d.saveNode(sheet, "t2");
    const budget = Budget.open(join(d2dir, "spend.json"), token(10), 113);
    await expect(d.run("sheet_MAYA", budget)).rejects.toThrow(/STOP/);
    expect(calls().filter((c) => c.startsWith("node confirm") && c.includes(d.state.nodes["sheet_MAYA"]?.nodeId ?? "x"))).toHaveLength(0);
    rmSync(d2dir, { recursive: true, force: true });
  });
});
