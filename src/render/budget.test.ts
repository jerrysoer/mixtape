import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { Budget } from "./budget.js";
import type { ApprovalToken } from "./quote.js";

const dir = mkdtempSync(join(tmpdir(), "mx-budget-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const token = (quoteId: string, maxCredits: number, maxUsd: number) => ({ quoteId, maxCredits, maxUsd }) as ApprovalToken;

describe("Budget", () => {
  it("records spend and refuses anything past the approved credits", () => {
    const b = Budget.open(join(dir, "a.json"), token("q-aaaaaaaaaa", 36, 1), 113);
    b.reserve("still 1", 12, 0);
    b.reserve("still 2", 12, 0);
    b.reserve("still 3", 12, 0);
    expect(() => b.reserve("retake", 12, 0)).toThrow(/STOP: retake/);
    expect(b.spent.credits).toBe(36);
  });

  it("counts credits in dollars against the approved total, with narration", () => {
    // 84 cr = $0.743; approval $0.80 leaves $0.057 for narration
    const b = Budget.open(join(dir, "b.json"), token("q-bbbbbbbbbb", 84, 0.8), 113);
    b.reserve("stills", 84, 0);
    expect(b.fits(0, 0.05)).toBe(true);
    expect(b.fits(0, 0.06)).toBe(false);
  });

  it("lets the exact approved amount through (regression: per-entry rounding blocked the 8th of 8 stills)", () => {
    // ep 1: 8 stills x 12 cr = 96 cr approved at $0.849558 (96/113)
    const b = Budget.open(join(dir, "exact.json"), token("q-eeeeeeeeee", 96, 0.849558), 113);
    for (let i = 0; i < 8; i++) b.reserve(`still ${i + 1}`, 12, 0);
    expect(b.spent.credits).toBe(96);
    expect(() => b.reserve("one more", 12, 0)).toThrow(/STOP/);
  });

  it("survives a restart and refuses a ledger from another quote", () => {
    const file = join(dir, "c.json");
    Budget.open(file, token("q-cccccccccc", 50, 1), 113).reserve("still", 12, 0);
    expect(Budget.open(file, token("q-cccccccccc", 50, 1), 113).spent.credits).toBe(12);
    expect(() => Budget.open(file, token("q-dddddddddd", 50, 1), 113)).toThrow(/belongs to q-cccccccccc/);
    expect((JSON.parse(readFileSync(file, "utf8")) as { entries: unknown[] }).entries).toHaveLength(1);
  });
});
