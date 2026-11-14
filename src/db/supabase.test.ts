import { describe, expect, it } from "vitest";
import { supabaseSink, type Fetch } from "./supabase.js";

const KEY = "service-role-SECRET";
const record = {
  brand: "Fuelwell",
  page: { pageId: "999000111", name: "Fuelwell", alias: null, verified: true, country: "US", likes: 1 },
  country: "US",
  pulledAt: "2026-11-07T00:00:00.000Z",
  ads: [{ id: "1000000001", pageId: "999000111", startDate: "2026-03-01", isActive: true, format: "video", videoUrls: ["https://v.example.test/a.mp4"], variantCount: 6, days: 251, score: 1, rank: 1 }],
};

describe("supabaseSink", () => {
  it("is off (files only) without both the URL and the service key", () => {
    expect(supabaseSink({ NEXT_PUBLIC_SUPABASE_URL: undefined, SUPABASE_SERVICE_ROLE_KEY: KEY })).toBeNull();
    expect(supabaseSink({ NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: undefined })).toBeNull();
  });

  it("upserts the brand then its ads on mx_ keys, without storing signed video urls", async () => {
    const calls: Array<{ url: string; body: unknown }> = [];
    const fake: Fetch = async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return new Response(JSON.stringify(url.includes("mx_brands") ? [{ id: "b-1" }] : []), { status: 201 });
    };
    const msg = await supabaseSink({ NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: KEY }, fake)?.save(record);
    expect(calls.map((c) => c.url)).toEqual(["https://x.supabase.co/rest/v1/mx_brands?on_conflict=mx_page_id", "https://x.supabase.co/rest/v1/mx_ads?on_conflict=mx_ad_id"]);
    expect((calls[1]?.body as Array<Record<string, unknown>>)[0]).toMatchObject({ mx_ad_id: "1000000001", mx_brand_id: "b-1", mx_video_count: 1, mx_winner_score: 1, mx_est_reach: null });
    expect(JSON.stringify(calls[1]?.body)).not.toContain("v.example.test");
    expect(msg).toMatch(/1 rows/);
  });

  it("reports a failed write by status only, never the key", async () => {
    const fake: Fetch = async () => new Response(`bad key ${KEY}`, { status: 401 });
    const e = await supabaseSink({ NEXT_PUBLIC_SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: KEY }, fake)
      ?.save(record)
      .then(() => new Error("no error"), (x: unknown) => x as Error);
    expect(e?.message).toMatch(/HTTP 401/);
    expect(e?.message).not.toContain(KEY);
  });

  it("refuses a non-https URL", () => {
    expect(() => supabaseSink({ NEXT_PUBLIC_SUPABASE_URL: "http://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: KEY })).toThrow(/https/);
  });
});
