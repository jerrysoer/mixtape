import { parseCsv, toCsv } from "./episodes.js";

/**
 * validation.csv (VALIDATION-PLAN §3): one row per post per platform. Mixtape fills the episode and
 * production columns; post links and metrics are filled later from TikTok Studio / IG insights.
 * Metrics are never estimated: a missing number stays blank. Re-running a batch keeps every
 * post and metric value already in the file.
 */

const EPISODE = ["ep", "title", "year", "decade", "format", "product", "hook_text", "hook_variant", "length_s", "source_kind"] as const;
const PRODUCTION = ["minutes_hands_on", "cost_usd", "hand_fixes", "qc_fails", "render_version"] as const;
const POST = ["platform", "posted_at", "url", "trial_reel"] as const;
const READ = ["views", "reach", "hold_2s_pct", "skip_rate_pct", "avg_watch_s", "full_watch_pct", "likes", "comments", "shares", "saves", "follows", "profile_visits", "fyp_or_nonfollower_pct"] as const;
const SNAPSHOTS = ["1h", "24h", "72h", "7d"] as const;
const DERIVED = ["shares_per_1k", "saves_per_1k", "follows_per_1k", "comments_naming_product"] as const;

export const COLUMNS: string[] = [...EPISODE, ...PRODUCTION, ...POST, ...SNAPSHOTS.flatMap((s) => READ.map((m) => `${m}_${s}`)), ...DERIVED];
export const PLATFORMS = ["tiktok", "ig"] as const;

/** Columns Mixtape owns and refreshes on every run; everything else is kept as found. */
const OWNED = new Set<string>(["ep", "title", "year", "decade", "format", "product", "hook_text", "length_s", "source_kind", "cost_usd", "render_version", "platform"]);

export interface ProducedRow {
  ep: number;
  title: string;
  year: number;
  format: string;
  product: string;
  hook_text: string;
  length_s: number;
  source_kind: string;
  cost_usd: number;
  /** Paid render rounds (first run + retakes). */
  render_version: number;
}

type Row = Record<string, string>;

function rate(n: string | undefined, views: string | undefined): string {
  const v = Number(views);
  if (!n || !views || !Number.isFinite(v) || v <= 0 || !Number.isFinite(Number(n))) return "";
  return ((Number(n) / v) * 1000).toFixed(1);
}

/** Per-1k rates from the 7-day read (the gates use the 7-day numbers). */
export function derive(r: Row): { shares_per_1k: string; saves_per_1k: string; follows_per_1k: string } {
  return { shares_per_1k: rate(r["shares_7d"], r["views_7d"]), saves_per_1k: rate(r["saves_7d"], r["views_7d"]), follows_per_1k: rate(r["follows_7d"], r["views_7d"]) };
}

function owned(p: ProducedRow, platform: string): Row {
  return {
    ep: String(p.ep),
    title: p.title,
    year: String(p.year),
    decade: `${Math.floor(p.year / 10) * 10}s`,
    format: p.format,
    product: p.product,
    hook_text: p.hook_text,
    length_s: p.length_s.toFixed(1),
    source_kind: p.source_kind,
    cost_usd: p.cost_usd.toFixed(2),
    render_version: String(p.render_version),
    platform,
  };
}

export function mergeValidation(existing: string | null, produced: ProducedRow[]): string {
  const table = existing ? parseCsv(existing) : [];
  const head = table[0] ?? [];
  const extra = head.filter((h) => !COLUMNS.includes(h));
  const cols = [...COLUMNS, ...extra];
  const rows = new Map<string, Row>();
  for (const r of table.slice(1)) {
    const row: Row = Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""]));
    rows.set(`${row["ep"]}/${row["platform"]}`, row);
  }
  for (const p of produced) {
    for (const platform of PLATFORMS) {
      const key = `${p.ep}/${platform}`;
      const prev = rows.get(key) ?? {};
      const row: Row = { hook_variant: "A", ...prev };
      for (const [k, v] of Object.entries(owned(p, platform))) if (OWNED.has(k)) row[k] = v;
      rows.set(key, row);
    }
  }
  const order = (k: string) => {
    const [ep = "0", platform = ""] = k.split("/");
    return Number(ep) * 10 + PLATFORMS.indexOf(platform as (typeof PLATFORMS)[number]);
  };
  const out = [...rows.entries()].sort(([a], [b]) => order(a) - order(b)).map(([, r]): Row => ({ ...r, ...derive(r) }));
  return toCsv([cols, ...out.map((r) => cols.map((c) => r[c] ?? ""))]);
}
