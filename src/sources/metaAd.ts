import { z } from "zod";
import { MixtapeError } from "../lib/io.js";

/**
 * A saved Meta Ad Library object (SearchAPI shape, DECISIONS "SearchAPI response facts").
 * Only the fields break needs; everything else is ignored. Untrusted input.
 */
const videoFields = z.object({ video_hd_url: z.string().nullish(), video_sd_url: z.string().nullish() }).passthrough();

const adSchema = z
  .object({
    ad_archive_id: z.coerce.string().regex(/^\d{5,25}$/),
    page_name: z.string().max(200).default("unknown page"),
    start_date: z.string(),
    end_date: z.string().nullish(),
    is_active: z.boolean().default(false),
    collation_count: z.number().int().min(1).nullish(),
    snapshot: z
      .object({
        body: z.union([z.object({ text: z.string().nullish() }).passthrough(), z.string()]).nullish(),
        videos: z.array(videoFields).nullish(),
        cards: z.array(videoFields.extend({ body: z.string().nullish() })).nullish(),
      })
      .passthrough(),
  })
  .passthrough();

export interface MetaAd {
  adId: string;
  pageName: string;
  daysRunning: number;
  variants: number;
  videoUrls: string[];
  adCopy: string;
}

export function daysBetween(startIso: string, endIso: string): number {
  const ms = Date.parse(endIso) - Date.parse(startIso);
  if (!Number.isFinite(ms)) throw new MixtapeError("Ad has an unreadable start or end date.");
  return Math.max(0, Math.floor(ms / 86_400_000));
}

export function parseMetaAd(raw: unknown, now: Date = new Date()): MetaAd {
  const r = adSchema.safeParse(raw);
  if (!r.success) throw new MixtapeError("That JSON is not a Meta Ad Library ad object (needs ad_archive_id, start_date, snapshot).");
  const a = r.data;
  const end = a.is_active || !a.end_date ? now.toISOString() : a.end_date;
  // Video URLs live in snapshot.videos[] (VIDEO) OR snapshot.cards[] (DCO): read both, HD first.
  const urls = [...(a.snapshot.videos ?? []), ...(a.snapshot.cards ?? [])]
    .map((v) => v.video_hd_url ?? v.video_sd_url)
    .filter((u): u is string => typeof u === "string" && u.startsWith("https://"));
  const body = typeof a.snapshot.body === "string" ? a.snapshot.body : (a.snapshot.body?.text ?? "");
  const cardBodies = (a.snapshot.cards ?? []).map((c) => c.body ?? "").filter(Boolean);
  return {
    adId: a.ad_archive_id,
    pageName: a.page_name.slice(0, 120),
    daysRunning: daysBetween(a.start_date, end),
    variants: a.collation_count ?? 1,
    videoUrls: [...new Set(urls)],
    adCopy: [body, ...cardBodies].filter(Boolean).join("\n"),
  };
}

/** A file may hold one ad, an array of ads, or a SearchAPI page ({ ads: [...] }). */
export function pickAd(json: unknown, adId?: string): unknown {
  const list: unknown[] = Array.isArray(json)
    ? json
    : json && typeof json === "object" && Array.isArray((json as { ads?: unknown }).ads)
      ? (json as { ads: unknown[] }).ads
      : [json];
  if (list.length === 1 && !adId) return list[0];
  if (!adId) throw new MixtapeError(`That file holds ${list.length} ads. Pick one with --ad <ad_archive_id>.`);
  const hit = list.find((a) => a && typeof a === "object" && String((a as { ad_archive_id?: unknown }).ad_archive_id) === adId);
  if (!hit) throw new MixtapeError(`Ad ${adId} is not in that file.`);
  return hit;
}
