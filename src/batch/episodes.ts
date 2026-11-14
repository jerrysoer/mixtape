import { readFileSync } from "node:fs";
import { MixtapeError } from "../lib/io.js";

/**
 * The episode file `mixtape batch` reads: one row per episode of the content plan
 * (VALIDATION-PLAN §5). CSV so Jerry can edit it in a spreadsheet.
 * Required: ep, title, year, format (F1-F14), product, punchline, hook, tone.
 * Optional: brief (overrides the built one), script (an existing script.json; skips press), slug.
 */

export interface Episode {
  ep: number;
  title: string;
  year: number;
  format: string;
  product: string;
  punchline: string;
  hook: string;
  tone: string;
  brief: string | null;
  script: string | null;
  slug: string;
}

const REQUIRED = ["ep", "title", "year", "format", "product", "punchline", "hook", "tone"] as const;
const SLUG = /^[a-z0-9][a-z0-9-]{2,63}$/;
const MAX_BYTES = 256 * 1024;

/** RFC 4180 CSV: quoted fields may hold commas, doubled quotes and newlines. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (quoted) throw new MixtapeError("CSV has an unclosed quote.");
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}

function cell(v: string): string {
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export function toCsv(rows: readonly (readonly string[])[]): string {
  return rows.map((r) => r.map(cell).join(",")).join("\n") + "\n";
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export function parseEpisodes(text: string): Episode[] {
  const [head, ...body] = parseCsv(text);
  if (!head) throw new MixtapeError("The episode file is empty.");
  const cols = head.map((h) => h.trim().toLowerCase());
  const missing = REQUIRED.filter((c) => !cols.includes(c));
  if (missing.length) throw new MixtapeError(`The episode file is missing column(s): ${missing.join(", ")}.`);
  const seen = new Set<number>();
  return body.map((r, i) => {
    const line = i + 2;
    const get = (c: string) => (r[cols.indexOf(c)] ?? "").trim();
    const bad = (c: string, why: string) => new MixtapeError(`Episode file row ${line}: ${c} ${why}.`);
    const ep = Number(get("ep"));
    if (!Number.isInteger(ep) || ep < 1) throw bad("ep", "must be a whole number from 1");
    if (seen.has(ep)) throw new MixtapeError(`Episode file: ep ${ep} appears twice.`);
    seen.add(ep);
    const year = Number(get("year"));
    if (!Number.isInteger(year) || year < 1900 || year > 2100) throw bad("year", `"${get("year")}" is not a year`);
    const format = get("format").toUpperCase();
    if (!/^F([1-9]|1[0-4])$/.test(format)) throw bad("format", `"${get("format")}" is not F1-F14`);
    for (const c of REQUIRED) if (!get(c)) throw bad(c, "is empty");
    const product = get("product");
    const slug = get("slug") || `cb-ep${String(ep).padStart(2, "0")}-${slugify(product)}`.slice(0, 64).replace(/-+$/, "");
    if (!SLUG.test(slug)) throw bad("slug", `"${slug}" must be lowercase letters, digits and dashes (3-64)`);
    return {
      ep,
      title: get("title"),
      year,
      format,
      product,
      punchline: get("punchline"),
      hook: get("hook"),
      tone: get("tone"),
      brief: get("brief") || null,
      script: get("script") || null,
      slug,
    };
  });
}

export function loadEpisodes(file: string): Episode[] {
  const buf = readFileSync(file);
  if (buf.length > MAX_BYTES) throw new MixtapeError("The episode file is too large (256 KB max).");
  return parseEpisodes(buf.toString("utf8"));
}

/** "2-4", "1,6", "1-3,6"; default: the first 5 rows in file order. */
export function pickRows(eps: Episode[], spec: string | undefined): Episode[] {
  if (!spec) return eps.slice(0, 5);
  const want: number[] = [];
  for (const part of spec.split(",").map((s) => s.trim()).filter(Boolean)) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(part);
    if (!m) throw new MixtapeError(`--rows: "${part}" is not a number or range.`);
    const a = Number(m[1]);
    const b = Number(m[2] ?? m[1]);
    for (let n = Math.min(a, b); n <= Math.max(a, b); n++) want.push(n);
  }
  return [...new Set(want)].map((n) => {
    const e = eps.find((x) => x.ep === n);
    if (!e) throw new MixtapeError(`--rows: ep ${n} is not in the episode file.`);
    return e;
  });
}

/** The press brief for a row. The punchline goes in verbatim so its numbers pass the claims guard. */
export function briefFor(e: Episode): string {
  if (e.brief) return e.brief;
  return [
    `Year: ${e.year}. Product: ${e.product} (generic, no brand, no real company).`,
    `A parody ad for a real-feeling ${e.year} product, played straight as a modern ad. Tone: ${e.tone}.`,
    `Punchline to land: "${e.punchline}"`,
    "Claims: only what the punchline says; no other numbers or results.",
    "Offer: none; end on the punchline and the product name.",
  ].join("\n");
}
