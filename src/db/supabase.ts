import type { Config } from "../config.js";
import { MixtapeError } from "../lib/io.js";
import type { PageMatch } from "../providers/data/types.js";

/**
 * Optional Supabase sink for spy (PLAN.md §3 db/). No URL or service key → files only.
 * Talks to PostgREST directly with the service role key, server side only (the CLI). That key
 * bypasses RLS, so it is read from .env.local and never printed. Video URLs are not stored:
 * they are signed and expire.
 */

export interface SpyRecord {
  brand: string;
  page: PageMatch;
  country: string;
  pulledAt: string;
  ads: Array<{
    id: string;
    pageId: string;
    startDate: string;
    endDate?: string | undefined;
    isActive: boolean;
    format: string;
    videoUrls: string[];
    bodyText?: string | undefined;
    ctaType?: string | undefined;
    linkUrl?: string | undefined;
    variantCount: number;
    days: number;
    score: number;
    rank: number;
  }>;
}

export interface AdSink {
  save(r: SpyRecord): Promise<string>;
}

export type Fetch = (input: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<Response>;

const CHUNK = 200;

export function supabaseSink(config: Pick<Config, "NEXT_PUBLIC_SUPABASE_URL" | "SUPABASE_SERVICE_ROLE_KEY">, doFetch: Fetch = (u, i) => fetch(u, i)): AdSink | null {
  const base = config.NEXT_PUBLIC_SUPABASE_URL;
  const key = config.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) return null;
  const url = new URL(base);
  if (url.protocol !== "https:") throw new MixtapeError("NEXT_PUBLIC_SUPABASE_URL must be an https URL.");

  async function upsert(table: string, conflict: string, rows: object[]): Promise<Array<{ id: string }>> {
    const res = await doFetch(`${url.origin}/rest/v1/${table}?on_conflict=${conflict}`, {
      method: "POST",
      headers: { apikey: key as string, Authorization: `Bearer ${key as string}`, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify(rows),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new MixtapeError(`Supabase ${table} upsert failed (HTTP ${res.status}). The data file was still saved.`);
    return (await res.json()) as Array<{ id: string }>;
  }

  return {
    async save(r) {
      const [brand] = await upsert("mx_brands", "mx_page_id", [
        { mx_name: r.brand, mx_page_id: r.page.pageId, mx_page_name: r.page.name, mx_country: r.country, mx_verified: r.page.verified, mx_last_pulled_at: r.pulledAt },
      ]);
      if (!brand) throw new MixtapeError("Supabase returned no brand row.");
      const rows = r.ads.map((a) => ({
        mx_ad_id: a.id,
        mx_brand_id: brand.id,
        mx_page_id: a.pageId || r.page.pageId,
        mx_start_date: a.startDate,
        mx_end_date: a.endDate ?? null,
        mx_is_active: a.isActive,
        mx_format: a.format,
        mx_video_count: a.videoUrls.length,
        mx_body_text: a.bodyText?.slice(0, 5000) ?? null,
        mx_cta_type: a.ctaType ?? null,
        mx_link_url: a.linkUrl ?? null,
        mx_days_running: a.days,
        mx_variant_count: a.variantCount,
        mx_est_reach: null,
        mx_winner_score: a.score,
        mx_rank: a.rank,
        mx_pulled_at: r.pulledAt,
      }));
      for (let i = 0; i < rows.length; i += CHUNK) await upsert("mx_ads", "mx_ad_id", rows.slice(i, i + CHUNK));
      return `Saved ${rows.length} rows to mx_ads`;
    },
  };
}
