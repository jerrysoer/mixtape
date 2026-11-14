import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { parseCsv } from "../batch/episodes.js";
import { loadConfig } from "../config.js";
import { batchApprove, batchDir, batchFinish, batchPrep, batchQcFinish, batchRun } from "./batch.js";

const root = mkdtempSync(join(tmpdir(), "mx-batch-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const free = loadConfig(root, { MX_IMAGE_SOURCE: "placeholder", MX_VIDEO_SOURCE: "placeholder", MX_VOICE_SOURCE: "say" });
const SAMPLE = readFileSync(new URL("../../fixtures/script.sample.json", import.meta.url), "utf8");

const HEAD = "ep,title,year,format,product,punchline,hook,tone,script,slug";

function scriptFile(name: string, style: string): string {
  const s = JSON.parse(SAMPLE) as { style_lock: { style_prompt: string } };
  s.style_lock.style_prompt = style;
  const f = join(root, `${name}.script.json`);
  writeFileSync(f, JSON.stringify(s));
  return f;
}

const hasTools = (() => {
  try {
    for (const [c, a] of [["ffmpeg", "-version"], ["magick", "-version"], ["say", "-v"]] as const) execFileSync(c, a === "-v" ? ["-v", "?"] : [a], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

describe("batch prep", () => {
  it("opens one press job per row (hook line from the file) and quotes nothing until every row has a script", async () => {
    const csv = join(root, "press.csv");
    writeFileSync(csv, `${HEAD}\n4,T9,2003,F5,T9 texting,"Typing hello takes 13 presses. What if it took 5?",Hello takes 13 presses.,deadpan,,\n`);
    const b = await batchPrep(csv, { name: "press-pack" }, root);
    expect(b.rows[0]).toMatchObject({ ep: 4, stage: "press", slug: "cb-ep04-t9-texting" });
    const job = b.rows[0]?.pressJob ?? "";
    expect(readFileSync(join(root, ".cache", "press", job, "prompt.md"), "utf8")).toContain("13 presses");
    const f = await batchFinish("press-pack", root, free);
    expect(f.pack).toBeNull();
    expect(f.rows[0]?.errors[0]).toMatch(/waiting for/);
  });

  it("records a row whose hook is too long for its format instead of failing the batch", async () => {
    const csv = join(root, "long.csv");
    writeFileSync(csv, `${HEAD}\n4,T9,2003,F5,T9 texting,punchline here,This hook is far too long for a two second spoken window,deadpan,,\n`);
    const b = await batchPrep(csv, { name: "long-hook" }, root);
    expect(b.rows[0]?.pressJob).toBeNull();
    expect(b.rows[0]?.errors[0]).toMatch(/max \d+ words/);
  });
});

describe.skipIf(!hasTools)("batch end to end (free: placeholder stills + say)", () => {
  it("one pack quote → approve → run → QC → validation.csv, and a wrong pack id approves nothing", async () => {
    const a = scriptFile("a", "flat paper cut-out, 9:16");
    const b2 = scriptFile("b", "pencil sketch, 9:16");
    const csv = join(root, "pack.csv");
    writeFileSync(csv, `${HEAD}\n1,Plateful A,1999,F2,meal planner,punch,hook,deadpan,${a},pack-a\n2,Plateful B,2004,F3,meal planner,punch,hook,deadpan,${b2},pack-b\n`);
    await batchPrep(csv, { name: "pack" }, root);
    const f = await batchFinish("pack", root, free);
    const pack = f.pack;
    if (!pack) throw new Error("no pack");
    expect(pack.items.map((i) => i.slug)).toEqual(["pack-a", "pack-b"]);
    // placeholder stills quote 0 cr; the pack total is the sum of the row quotes
    expect(pack.credits).toBe(pack.items.reduce((n, i) => n + i.credits, 0));
    expect(readFileSync(join(batchDir(root, "pack"), "PACK.md"), "utf8")).toContain(pack.id);

    await expect(batchApprove("pack", "p-0000000000", root, free)).rejects.toThrow(/does not match/);
    expect(existsSync(join(root, "renders", "pack-a", "approval.json"))).toBe(false);
    await expect(batchRun("pack", root, free)).rejects.toThrow(/not approved/);

    await batchApprove("pack", pack.id, root, free);
    for (const s of ["pack-a", "pack-b"]) expect(JSON.parse(readFileSync(join(root, "renders", s, "approval.json"), "utf8"))).toMatchObject({ quoteId: pack.items.find((i) => i.slug === s)?.quoteId });

    const run = await batchRun("pack", root, free);
    expect(run.rows.map((r) => r.status)).toEqual(["awaiting QC", "awaiting QC"]);

    // stills QC: pass every shot of pack-a; leave pack-b unanswered. In motion mode a stills pass only locks the row.
    const plan = JSON.parse(readFileSync(join(root, "renders", "pack-a", "plan.json"), "utf8")) as { shots: { n: number }[] };
    writeFileSync(join(root, "renders", "pack-a", "qc", "answer.json"), JSON.stringify({ shots: plan.shots.map((s) => ({ id: `shot_${String(s.n).padStart(2, "0")}`, frame: "pass", anatomy: "pass", note: "ok" })) }));
    const locked = batchQcFinish("pack", root);
    expect(locked.batch.rows.map((r) => r.status)).toEqual(["stills locked (clip quote next: --finish)", "awaiting QC"]);
    expect(locked.delivered).toBe(0);

    // second loop: the pack now quotes pack-a's clips (pack-b is still at its stills), approve, run, clip QC
    const pack2 = (await batchFinish("pack", root, free)).pack;
    if (!pack2) throw new Error("no clip pack");
    expect(pack2.id).not.toBe(pack.id);
    expect((JSON.parse(readFileSync(join(root, "renders", "pack-a", "plan.json"), "utf8")) as { stage: string }).stage).toBe("clips");
    expect((JSON.parse(readFileSync(join(root, "renders", "pack-b", "plan.json"), "utf8")) as { stage: string }).stage).toBe("stills");
    await batchApprove("pack", pack2.id, root, free);
    const run2 = await batchRun("pack", root, free);
    expect(run2.rows.map((r) => r.status)).toEqual(["awaiting QC", "awaiting QC"]);
    expect(existsSync(join(root, "renders", "pack-a", "clips", "clip_01.mp4"))).toBe(true);
    writeFileSync(join(root, "renders", "pack-a", "qc", "answer.json"), JSON.stringify({ shots: plan.shots.map((s) => ({ id: `clip_${String(s.n).padStart(2, "0")}`, frame: "pass", anatomy: "pass", motion: "pass", lips: "n/a", note: "ok" })) }));
    const q = batchQcFinish("pack", root);
    expect(q.batch.rows.map((r) => r.status)).toEqual(["delivered", "awaiting QC"]);
    const [head = [], ...rows] = parseCsv(readFileSync(q.csv, "utf8"));
    expect(rows).toHaveLength(2);
    const row = Object.fromEntries(head.map((h, i) => [h, rows[0]?.[i] ?? ""]));
    expect(row).toMatchObject({ ep: "1", platform: "tiktok", decade: "1990s", cost_usd: "0.00", views_7d: "", url: "" });
    expect(Number(row["length_s"])).toBeGreaterThan(5);
  }, 300_000);
});

describe("pack quote at Dreamina prices (quote only, nothing runs)", () => {
  it("sums each row's render quote into one pack, and the pack id changes when any row's quote changes", async () => {
    // Dreamina prices for the stills, free voice: with ElevenLabs the first quote would be the voice stage.
    const paid = loadConfig(root, { MX_VOICE_SOURCE: "say" });
    const a = scriptFile("qa", "linocut print, 9:16");
    const b2 = scriptFile("qb", "watercolour wash, 9:16");
    const csv = join(root, "quote.csv");
    writeFileSync(csv, `${HEAD}\n1,A,1999,F2,meal planner,punch,hook,deadpan,${a},quote-a\n2,B,2004,F3,meal planner,punch,hook,deadpan,${b2},quote-b\n`);
    await batchPrep(csv, { name: "quote-pack" }, root);
    const first = (await batchFinish("quote-pack", root, paid)).pack;
    expect(first?.credits).toBe(168);
    expect(first?.items.map((i) => i.credits)).toEqual([84, 84]);
    scriptFile("qb", "charcoal, 9:16");
    const second = (await batchFinish("quote-pack", root, paid)).pack;
    expect(second?.id).not.toBe(first?.id);
    await expect(batchApprove("quote-pack", first?.id ?? "", root, paid)).rejects.toThrow(/does not match/);
  });
});
