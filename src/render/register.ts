import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { MixtapeError } from "../lib/io.js";

/**
 * The narration bank (docs/NARRATION-BANK.md, "## Registers" table) read as data, so `press --register <id>`
 * can quote a register's row in the prompt and put its delivery tag in front of the take. The
 * markdown stays the source of truth because Jerry edits it after listening; only the table is parsed.
 */
export interface Register {
  id: string;
  who: string;
  move: string;
  rhythm: string;
  /** v4 delivery tag, "[casual, amused]"; empty when the row has none. */
  tag: string;
  example: string;
}

export const REGISTER_ID = /^[a-z][a-z0-9_]{1,40}$/;
export const BANK_FILE = join("docs", "NARRATION-BANK.md");

function cell(s: string): string {
  return s.trim().replace(/^`|`$/g, "").trim();
}

/** Parse the registers table out of the bank's markdown. Rows start with "| `id` |". */
export function parseRegisters(markdown: string): Register[] {
  const out: Register[] = [];
  const section = markdown.split(/^## Registers\s*$/m)[1]?.split(/^## /m)[0] ?? "";
  for (const line of section.split("\n")) {
    if (!line.startsWith("|")) continue;
    const cells = line.split("|").slice(1, -1).map(cell);
    const id = cells[0] ?? "";
    if (id === "id" || !REGISTER_ID.test(id) || cells.length < 6) continue;
    const tag = cells[4] ?? "";
    out.push({ id, who: cells[1] ?? "", move: cells[2] ?? "", rhythm: cells[3] ?? "", tag: /^\[[^\]]{2,80}\]$/.test(tag) ? tag : "", example: cells[5] ?? "" });
  }
  return out;
}

export function loadRegisters(root: string): Register[] {
  const file = join(root, BANK_FILE);
  if (!existsSync(file)) return [];
  return parseRegisters(readFileSync(file, "utf8"));
}

export function findRegister(root: string, id: string): Register {
  if (!REGISTER_ID.test(id)) throw new MixtapeError(`--register "${id}" is not a register id (lowercase, underscores).`);
  const all = loadRegisters(root);
  if (!all.length) throw new MixtapeError(`No registers: ${BANK_FILE} has no "## Registers" table.`);
  const r = all.find((x) => x.id === id);
  if (!r) throw new MixtapeError(`No register "${id}" in ${BANK_FILE}. Known: ${all.map((x) => x.id).join(", ")}.`);
  return r;
}
