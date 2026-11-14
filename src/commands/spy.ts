import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadConfig, type Config } from "../config.js";
import { supabaseSink, type AdSink } from "../db/supabase.js";
import { MixtapeError, out } from "../lib/io.js";
import { pickPage, searchApi } from "../providers/data/searchapi.js";
import type { Ad, DataSource, PageMatch } from "../providers/data/types.js";
import { rankWithinBrand } from "../score/winner.js";
import { daysBetween } from "../sources/metaAd.js";

/**
 * mixtape spy <brand> (add-on, sprint 7): the brand's verified page → every active ad (video by default)
 * → days running, Meta's variant count, mx_winner_score ranked within the brand → data/<brand>.json
 * (+ mx_ads when Supabase is configured). Meta discloses no spend or reach: none is shown or guessed.
 */

export interface SpyOptions {
  country: string;
  max: number;
  allMedia: boolean;
  pageId?: string | undefined;
  fresh?: boolean | undefined;
}

export interface RankedAd extends Ad {
  days: number;
  score: number;
  rank: number;
}

export interface SpyResult {
  brand: string;
  page: PageMatch;
  ads: RankedAd[];
  total: number | null;
  calls: number;
  file: string;
  stored: string;
}

const BRAND = /^[a-z0-9][a-z0-9 &.'-]{0,59}$/i;

export function brandSlug(brand: string): string {
  if (!BRAND.test(brand.trim())) throw new MixtapeError("Brand must be 1-60 letters, numbers, spaces or & . ' - (it names data/<brand>.json).");
  return brand
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export async function runSpy(brand: string, o: SpyOptions, deps: { root: string; source: DataSource; now?: Date; db: AdSink | null }): Promise<SpyResult> {
  const slug = brandSlug(brand);
  const now = deps.now ?? new Date();
  const pages = await deps.source.findPage(brand.trim(), o.country);
  let page: PageMatch | null;
  if (o.pageId) {
    page = pages.find((p) => p.pageId === o.pageId) ?? { pageId: o.pageId, name: brand.trim(), alias: null, verified: false, country: null, likes: 0 };
  } else {
    page = pickPage(pages, brand, o.country);
    if (!page) {
      const list = pages
        .slice(0, 5)
        .map((p) => `  ${p.pageId}  ${p.name}${p.verified ? " (verified)" : ""}${p.country ? ` ${p.country}` : ""}`)
        .join("\n");
      throw new MixtapeError(`No verified page named "${brand.trim()}". Pick one with --page-id <id>:\n${list || "  (no pages found)"}`);
    }
  }

  const byId = new Map<string, Ad>();
  let total: number | null = null;
  for await (const p of deps.source.listAds({ pageId: page.pageId, country: o.country, active: true, media: o.allMedia ? "all" : "video", maxAds: o.max })) {
    total ??= p.total ?? null;
    for (const a of p.ads) if (!byId.has(a.id) && byId.size < o.max) byId.set(a.id, a);
  }

  const withDays = [...byId.values()].flatMap((a) => {
    try {
      const end = a.isActive || !a.endDate ? now.toISOString() : a.endDate;
      return [{ ...a, days: daysBetween(a.startDate, end), variants: a.variantCount }];
    } catch {
      return [];
    }
  });
  const ranked: RankedAd[] = rankWithinBrand(withDays);

  const file = join(deps.root, "data", `${slug}.json`);
  mkdirSync(join(deps.root, "data"), { recursive: true });
  const saved = {
    brand: brand.trim(),
    source: deps.source.name,
    country: o.country,
    pulledAt: now.toISOString(),
    page,
    totalReported: total,
    calls: deps.source.calls(),
    note: "Ranked within this brand by mx_winner_score (days running 0.6, Meta variant count 0.25; reach unknown so its weight is 0). Video URLs are signed and expire.",
    ads: ranked.map((a) => ({
      ...(a.raw as Record<string, unknown>),
      mx_rank: a.rank,
      mx_days_running: a.days,
      mx_variant_count: a.variantCount,
      mx_winner_score: a.score,
    })),
  };
  writeFileSync(file, JSON.stringify(saved, null, 1));

  const stored = deps.db ? await deps.db.save({ brand: brand.trim(), page, country: o.country, pulledAt: now.toISOString(), ads: ranked }) : "Supabase not configured: files only";
  return { brand: brand.trim(), page, ads: ranked, total, calls: deps.source.calls(), file, stored };
}

export async function spyCommand(brand: string, raw: { country?: string; max?: string; allMedia?: boolean; pageId?: string; fresh?: boolean }, root = process.cwd()): Promise<number> {
  const config: Config = loadConfig(root);
  if (config.MX_DATA_SOURCE !== "searchapi") throw new MixtapeError(`MX_DATA_SOURCE=${config.MX_DATA_SOURCE} is not built yet; searchapi is.`);
  const country = (raw.country ?? "US").toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) throw new MixtapeError("--country takes a 2-letter code, e.g. US.");
  const max = raw.max === undefined ? 300 : Number(raw.max);
  if (!Number.isInteger(max) || max < 1 || max > 2000) throw new MixtapeError("--max takes a whole number from 1 to 2000.");
  if (raw.pageId !== undefined && !/^\d{1,25}$/.test(raw.pageId)) throw new MixtapeError("--page-id takes the numeric page id.");

  const started = Date.now();
  const source = searchApi({ key: config.SEARCHAPI_KEY, cacheDir: join(root, ".cache", "api", "searchapi"), fresh: raw.fresh });
  const r = await runSpy(brand, { country, max, allMedia: Boolean(raw.allMedia), pageId: raw.pageId, fresh: raw.fresh }, { root, source, db: supabaseSink(config) });
  const secs = ((Date.now() - started) / 1000).toFixed(1);

  out(`${r.page.name} (page ${r.page.pageId}${r.page.verified ? ", verified" : ""}${r.page.country ? `, ${r.page.country}` : ""})`);
  out(`${r.ads.length} active ${raw.allMedia ? "" : "video "}ads${r.total !== null ? ` of ${r.total} reported` : ""} in ${secs} s, ${r.calls} SearchAPI request(s)`);
  out("");
  out("rank  score  days  variants  format  ad id");
  for (const a of r.ads.slice(0, 15)) out(`${String(a.rank).padStart(4)}  ${a.score.toFixed(3)}  ${String(a.days).padStart(4)}  ${String(a.variantCount).padStart(8)}  ${a.format.padEnd(6)}  ${a.id}`);
  out("");
  out(`Saved ${r.file.replace(root + "/", "")}. ${r.stored}.`);
  out(`Spend and reach: not disclosed by Meta for commercial ads, so none is shown.`);
  out(`Next: mixtape break ${r.file.replace(root + "/", "")} --ad ${r.ads[0]?.id ?? "<ad id>"}`);
  return 0;
}
