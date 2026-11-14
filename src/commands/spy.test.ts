import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { pickAd, parseMetaAd } from "../sources/metaAd.js";
import { searchApi, type Fetch } from "../providers/data/searchapi.js";
import { runSpy } from "./spy.js";

const root = mkdtempSync(join(tmpdir(), "mx-spy-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const fx = (n: string): unknown => JSON.parse(readFileSync(new URL(`../../fixtures/searchapi/${n}.json`, import.meta.url), "utf8"));

function routed(): Fetch {
  return async (input) => {
    const u = new URL(String(input));
    const body = u.searchParams.get("engine") === "meta_ad_library_page_search" ? fx("fuelwell-pages") : u.searchParams.get("next_page_token") ? fx("fuelwell-ads-p2") : fx("fuelwell-ads-p1");
    return new Response(JSON.stringify(body), { status: 200 });
  };
}

describe("spy", () => {
  it("resolves the verified page, paginates, dedupes, ranks within the brand and saves data/<brand>.json", async () => {
    const source = searchApi({ key: "k", fetch: routed(), cacheDir: join(root, ".cache"), sleep: async () => {} });
    const now = new Date("2026-11-07T00:00:00Z");
    const r = await runSpy("Fuelwell", { country: "US", max: 300, allMedia: false }, { root, source, now, db: null });
    expect(r.page.pageId).toBe("999000111");
    expect(r.file).toBe(join(root, "data", "fuelwell.json"));
    const saved = JSON.parse(readFileSync(r.file, "utf8")) as { brand: string; page: { pageId: string }; calls: number; ads: Array<Record<string, unknown>> };
    expect(saved.calls).toBe(3);
    expect(saved.ads.map((a) => a["ad_archive_id"])).toEqual(["1000000001", "1000000003", "1000000004", "1000000002"]);
    expect(saved.ads[0]).toMatchObject({ mx_rank: 1, mx_days_running: 251, mx_variant_count: 6, mx_winner_score: 1 });
    // inactive ad: days counted to its end date
    expect(saved.ads.find((a) => a["ad_archive_id"] === "1000000004")).toMatchObject({ mx_days_running: 61 });
    // the saved file feeds straight into break
    expect(parseMetaAd(pickAd(saved, "1000000003"), now).videoUrls).toEqual(["https://video.example.test/fw3.mp4"]);
  });

  it("refuses an unverified-only match unless a page id is given", async () => {
    const unverified: Fetch = async (input) => {
      const u = new URL(String(input));
      if (u.searchParams.get("engine") === "meta_ad_library_page_search")
        return new Response(JSON.stringify({ page_results: [{ page_id: "555", name: "Fuelwell Fan Club", verification: "NOT_VERIFIED", likes: 9 }] }), { status: 200 });
      return new Response(JSON.stringify(fx("fuelwell-ads-p2")), { status: 200 });
    };
    const source = () => searchApi({ key: "k", fetch: unverified, cacheDir: join(root, `.c${Math.random()}`), sleep: async () => {} });
    await expect(runSpy("Fuelwell", { country: "US", max: 300, allMedia: false }, { root, source: source(), db: null })).rejects.toThrow(/--page-id/);
    const r = await runSpy("Fuelwell", { country: "US", max: 300, allMedia: false, pageId: "555" }, { root, source: source(), db: null });
    expect(r.ads.length).toBe(2);
  });

  it("rejects a brand name that cannot be a file name", async () => {
    const source = searchApi({ key: "k", fetch: routed(), cacheDir: join(root, ".cache"), sleep: async () => {} });
    await expect(runSpy("../../etc", { country: "US", max: 300, allMedia: false }, { root, source, db: null })).rejects.toThrow(/brand/i);
  });
});
