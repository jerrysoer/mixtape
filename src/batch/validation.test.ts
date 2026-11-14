import { describe, expect, it } from "vitest";
import { parseCsv, toCsv } from "./episodes.js";
import { COLUMNS, derive, mergeValidation, type ProducedRow } from "./validation.js";

function produced(over: Partial<ProducedRow> = {}): ProducedRow {
  return {
    ep: 1,
    title: "Dial-up",
    year: 1999,
    format: "F2",
    product: "dial-up internet",
    hook_text: "POV: 87% into one song",
    length_s: 18,
    source_kind: "template",
    cost_usd: 1.49,
    render_version: 3,
    ...over,
  };
}

function rowsOf(csv: string): Record<string, string>[] {
  const [head = [], ...body] = parseCsv(csv);
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])));
}

describe("validation.csv columns", () => {
  it("has the episode, production, post, four snapshot reads and derived groups from VALIDATION-PLAN §3", () => {
    for (const c of ["ep", "decade", "hook_variant", "minutes_hands_on", "cost_usd", "platform", "url", "trial_reel", "views_1h", "hold_2s_pct_24h", "skip_rate_pct_72h", "fyp_or_nonfollower_pct_7d", "shares_per_1k", "comments_naming_product"]) {
      expect(COLUMNS, c).toContain(c);
    }
    expect(new Set(COLUMNS).size).toBe(COLUMNS.length);
  });
});

describe("mergeValidation", () => {
  it("writes one row per episode per platform with metrics blank (never estimated)", () => {
    const rows = rowsOf(mergeValidation(null, [produced(), produced({ ep: 2, year: 2004, format: "F3" })]));
    expect(rows.map((r) => `${r["ep"]}/${r["platform"]}`)).toEqual(["1/tiktok", "1/ig", "2/tiktok", "2/ig"]);
    expect(rows[0]).toMatchObject({ decade: "1990s", hook_variant: "A", cost_usd: "1.49", views_7d: "", shares_per_1k: "", minutes_hands_on: "" });
    expect(rows[2]?.["decade"]).toBe("2000s");
  });

  it("keeps metrics and post fields already filled in, and refreshes production fields", () => {
    const first = rowsOf(mergeValidation(null, [produced()]));
    const filled = first.map((r) => (r["platform"] === "tiktok" ? { ...r, url: "https://tiktok.example/v/1", views_7d: "1200", shares_7d: "18", minutes_hands_on: "25" } : r));
    const csv = toCsv([COLUMNS, ...filled.map((r) => COLUMNS.map((c) => r[c] ?? ""))]);
    const again = rowsOf(mergeValidation(csv, [produced({ cost_usd: 1.6, render_version: 4 })]));
    const tt = again.find((r) => r["platform"] === "tiktok");
    expect(tt).toMatchObject({ url: "https://tiktok.example/v/1", views_7d: "1200", minutes_hands_on: "25", cost_usd: "1.60", render_version: "4", shares_per_1k: "15.0" });
  });

  it("keeps rows for episodes not in this batch", () => {
    const csv = mergeValidation(null, [produced({ ep: 9 })]);
    const rows = rowsOf(mergeValidation(csv, [produced()]));
    expect(rows.map((r) => r["ep"])).toEqual(["1", "1", "9", "9"]);
  });

  it("keeps extra columns someone added by hand", () => {
    const csv = mergeValidation(null, [produced()]).replace(/^ep,/, "notes,ep,").replace(/\n(\d)/g, "\nhi,$1");
    const out = mergeValidation(csv, [produced()]);
    expect(out.split("\n")[0]).toMatch(/,notes$/);
    expect(rowsOf(out)[0]?.["notes"]).toBe("hi");
  });
});

describe("derive", () => {
  it("computes per-1k rates from the 7-day read, and leaves them blank without views", () => {
    expect(derive({ views_7d: "2000", shares_7d: "30", saves_7d: "10", follows_7d: "4" })).toEqual({ shares_per_1k: "15.0", saves_per_1k: "5.0", follows_per_1k: "2.0" });
    expect(derive({ views_7d: "", shares_7d: "3" })).toEqual({ shares_per_1k: "", saves_per_1k: "", follows_per_1k: "" });
    expect(derive({ views_7d: "100", shares_7d: "" })).toMatchObject({ shares_per_1k: "" });
  });
});
