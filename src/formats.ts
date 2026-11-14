import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { MixtapeError } from "./lib/io.js";
import { formatIssues, structureSchema, type Structure } from "./schema/structure.js";

/** templates/formats/ ships in the npm package next to dist/ (and next to src/ in the repo). */
export const FORMATS_DIR = fileURLToPath(new URL("../templates/formats/", import.meta.url));

export function listFormatIds(dir: string = FORMATS_DIR): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .map((f) => /^(F\d+)\.structure\.json$/.exec(f)?.[1])
    .filter((id): id is string => Boolean(id))
    .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
}

/** Load and validate a built-in format by id ("F3", case-insensitive). */
export function loadFormat(id: string, dir: string = FORMATS_DIR): Structure {
  const norm = id.trim().toUpperCase();
  if (!/^F\d{1,3}$/.test(norm)) throw new MixtapeError(`"${id}" is not a format id (F1-F14).`);
  const path = `${dir}${norm}.structure.json`;
  if (!existsSync(path)) throw new MixtapeError(`No built-in format ${norm}. Available: ${listFormatIds(dir).join(", ")}.`);
  const parsed = structureSchema.safeParse(JSON.parse(readFileSync(path, "utf8")));
  if (!parsed.success) throw new MixtapeError(`Built-in format ${norm} is invalid:\n  ${formatIssues(parsed.error).join("\n  ")}`);
  return parsed.data;
}
