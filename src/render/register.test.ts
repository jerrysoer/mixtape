import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { findRegister, loadRegisters, parseRegisters } from "./register.js";

const root = mkdtempSync(join(tmpdir(), "mx-register-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const BANK = `# Narration bank

## Rules

1. One speaker.

## Registers

| id | who → whom | the move | rhythm | delivery tag (v4) | example | used in | verdict |
|---|---|---|---|---|---|---|---|
| \`story_dont_laugh\` | you → best friend | opens with "don't laugh" | short bursts | \`[casual, amused, a little breathless]\` | "Okay so, don't laugh." | ep 7 | **best** |
| \`voice_note\` | you → friend, a voice memo | starts mid-thought | run-on | \`[relaxed, recorded on a phone]\` | — | — | — |
| \`Bad Id\` | x | x | x | x | x | x | x |

## Next

- nothing
`;

describe("register bank", () => {
  it("parses the registers table (id, who, move, rhythm, tag, example) and skips bad rows", () => {
    const r = parseRegisters(BANK);
    expect(r.map((x) => x.id)).toEqual(["story_dont_laugh", "voice_note"]);
    expect(r[0]).toMatchObject({ who: "you → best friend", move: 'opens with "don\'t laugh"', rhythm: "short bursts", tag: "[casual, amused, a little breathless]", example: '"Okay so, don\'t laugh."' });
  });

  it("finds a register by id from docs/NARRATION-BANK.md and names the known ones when it is missing", () => {
    expect(loadRegisters(root)).toEqual([]);
    expect(() => findRegister(root, "voice_note")).toThrow(/No registers/);
    mkdirSync(join(root, "docs"), { recursive: true });
    writeFileSync(join(root, "docs", "NARRATION-BANK.md"), BANK);
    expect(findRegister(root, "voice_note").tag).toBe("[relaxed, recorded on a phone]");
    expect(() => findRegister(root, "overheard_argument")).toThrow(/Known: story_dont_laugh, voice_note/);
    expect(() => findRegister(root, "../x")).toThrow(/not a register id/);
  });
});
