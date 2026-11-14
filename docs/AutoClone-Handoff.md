# AutoClone — Claude Code Handoff

**Date:** November 6, 2026
**Owner:** Jerry (jerrysoer)
**Repo (to create):** `jerrysoer/autoclone`
**PRD:** `claude/AutoClone-PRD.md` (v0.1 in the Vibe coding project). **This handoff overrides the PRD wherever they differ** (see "Decisions since PRD v0.1").
**Prototype:** AutoClone Prototype artifact on claude.ai (mock ads, live Claude for Hook + Adapt steps)

---

## 1. What we're building (one paragraph)

AutoClone finds a brand's **longest-running Meta ads** (days running = proven winner), breaks a winner down into a reusable format file (`structure.json`), writes 5 scored hooks in the winner's hook pattern, adapts the format to our own product or story (`script.json`), and hands the script to our existing **Dreamina + /2minvid** workflow to render. Only the format carries over; every line, shot and sound in our version is new. It ships as an **open-source CLI + Claude Code skill**, where each user brings their own data-source key.

**Pipeline:** `spy → pick → break → hook → adapt → render`

---

## 2. Decisions since PRD v0.1 (apply these)

| # | Decision | Replaces in PRD |
|---|---|---|
| D1 | **Meta only.** TikTok removed from all phases (one ad library, one data contract). | §2 Phase 2 "TikTok Creative Center" |
| D2 | **Default data source = SearchAPI** (`engine=meta_ad_library`). Covers US ads, no Facebook account or ID check. | §4 Meta Ad Library API as Phase 1 source |
| D3 | **Swappable data source** via `AC_DATA_SOURCE=searchapi \| apify \| meta`. Official Meta API (EU-delivered ads only, needs ID verification) becomes an optional adapter. | §4 |
| D4 | **Open source, bring your own key.** No hosted paid version on Jerry's credentials. | §8 monetization assumptions |
| D5 | **Public demo = cached snapshot.** 5–10 pre-pulled global brands stored in Supabase; no free-text brand search; live Claude for hook/adapt (rate-limited); pre-rendered example clones; CTA "clone the repo for any brand." | New |
| D6 | **Render step = Dreamina + /2minvid**, not Replicate/Seedance/Remotion. AutoClone's job ends at a render-ready `script.json` + shot prompts in the format /2minvid expects. | §2 F5, §5 render stack |
| D7 | **AutoHook is optional.** Phase 1 ships the built-in Claude hook step (10 hooks → score → top 5). AutoHook plugs into the same `hook.candidates` slot later. | §2 F3 |
| D8 | **Days running is the primary signal.** Meta discloses no spend/reach for commercial ads; any spend number is labeled "estimated" or omitted. | §4 winner score weights stay |

---

## 3. Open items to resolve first (in order)

1. **SearchAPI test (blocking).** Last attempt failed with `Invalid API key`: the key was 23 chars (likely truncated) and placeholders were pasted literally. Run the test through the `searchapi` MCP in Claude Code instead of manual curl. **Jerry: regenerate the SearchAPI key after testing** (the old one appeared in a screenshot).
2. **Video URL availability.** SearchAPI docs don't show the shape of `snapshot.videos`. Inspect one real ad object. If no downloadable URL, fall back to fetching media from the ad's Ad Library page with `yt-dlp` locally.
3. **/2minvid input format.** Read the /2minvid skill and define the exact handoff file AutoClone must produce.
4. **Outside-activity approval** for a public open-source side project (owner, before launch).

### SearchAPI pass/fail
| Check | Pass |
|---|---|
| Ads per call | ~25, with `pagination.next_page_token` |
| `start_date` | Present on every ad |
| Video | Most ads have a usable video URL in `snapshot.videos` |
| `page_name` | Mostly the real brand (if noisy, switch to `page_id` search) |
| Oldest `start_date` | Several months back |

Test brands: **huel, gymshark, ag1** (global brands, long-running winners).

### SearchAPI reference
- Endpoint: `GET https://www.searchapi.io/api/v1/search?engine=meta_ad_library`
- Auth: `api_key` param or `Authorization: Bearer`
- Params: `q` or `page_id`, `country` (default ALL), `active_status` (active|inactive|all), `media_type` (all|video|image|…), `platforms`, `start_date`/`end_date`, `sort_by` (most_recent|impressions_high_to_low), `next_page_token` (can exceed 8KB → POST with JSON body)
- Ad fields: `ad_archive_id`, `page_id`, `page_name`, `is_active`, `start_date`, `end_date`, `publisher_platform`, `snapshot{body.text, cards, images, videos, link_url, cta_type, display_format}`
- Cost: per search credit (~25 ads/call). Check plan on dashboard.

### Other data-source adapters (later)
- **Apify** Ad Library scrapers: no Meta login, US coverage, ~$0.30–$1.00 per 1,000 ads.
- **Official Meta API** (`graph.facebook.com/v24.0/ads_archive`): free, needs facebook.com/ID verification + developer app + `ads_read` token (60-day). Returns commercial ads **only if delivered in the EU**. Terms reportedly prohibit reselling archive data.

---

## 4. Phase 1 scope (CLI + skill)

| Cmd | Does | Acceptance |
|---|---|---|
| `ac spy <brand>` | Pull active ads via data-source adapter; compute days running, variant count, `ac_winner_score`; save to Supabase + `./data/<brand>.json` | ≥100 ads for a global brand in <60s; sorted by score |
| `ac break <ad_id>` | Download media to `./.cache/sources/` (gitignored), ffmpeg scene detection, faster-whisper transcript, Claude reads keyframes → `structure.json` | Schema-valid for 9/10 test ads; stores roles/patterns, never original lines |
| `ac hook <structure>` | Claude writes 10 hooks in the pattern, scores scroll/curiosity/fit, keeps top 5 → `hook.candidates` | 5 ranked hooks; AutoHook used if `AUTOHOOK_PATH` set |
| `ac adapt <structure> "<brief>"` | Claude writes `script.json`: one line + one generator-ready shot prompt per beat, same roles and timing | Timing within ±10%; originality check passes (no >6-word overlap with source transcript) |
| `ac export <script>` | Emit the /2minvid handoff file | /2minvid renders it without manual edits |

**Winner score:** `0.6·norm(days_running) + 0.25·norm(variant_count) + 0.15·norm(est_reach)` (reach weight drops to 0 when unavailable; renormalize).

**Variant count:** cluster a brand's ads by near-duplicate body text + same video duration (±1s) + same first frame hash.

---

## 5. Contracts

### structure.json (shared with AutoHook)
```json
{
  "source": { "platform": "meta", "ad_id": "…", "page_name": "…", "days_running": 286, "variants": 14 },
  "duration_s": 24.0,
  "aspect": "9:16",
  "format": "founder_talking_head",
  "hook": { "t": [0, 2.5], "pattern": "contrarian_reveal", "text_role": "denies the obvious answer", "candidates": [] },
  "beats": [
    { "t": [2.5, 7], "role": "problem", "visual": "close-up, relatable frustration", "caption_style": "bold white, 2 lines, center-safe" },
    { "t": [7, 14], "role": "demo", "visual": "product in real use, handheld" },
    { "t": [14, 20], "role": "proof", "visual": "result on screen, number overlay" },
    { "t": [20, 24], "role": "cta", "visual": "product hero + offer card" }
  ],
  "audio": { "music": "upbeat lo-fi 100–110 bpm", "sfx": ["whoosh on cuts"], "voice": "creator VO" },
  "rules": "roles and patterns only — no original lines, footage, audio or likeness"
}
```
Hook patterns seen so far: `contrarian_reveal`, `stop_doing_x`, `pov`, `day_in_life`, `number_shock`, `sensory`, `myth_bust`, `announcement`, `testimonial`.

### script.json
```json
{
  "brief": "…",
  "hook": { "t": [0, 2.5], "line": "…", "visual": "…" },
  "beats": [ { "t": [2.5, 7], "role": "problem", "line": "…", "visual": "…" } ],
  "style_lock": { "style_prompt": "…", "reference_image": "path or url" },
  "checks": { "overlap_passed": true, "timing_within_10pct": true }
}
```

### Prompts proven in the prototype
**Hook:** "You are a short-form ad hook writer. Write 10 original hooks (max 12 words each) for this topic: {topic}. They must follow this hook pattern from a proven long-running ad: {pattern} (role: {text_role}). Format of the source ad: {format}. Score each 1-10 on scroll, curiosity, fit. Be a harsh judge; spread scores. Return JSON only: {"hooks":[{"text","scroll","curiosity","fit"}]}"
Final score = `0.45·scroll + 0.35·curiosity + 0.2·fit`.

**Adapt:** "You adapt proven ad FORMATS into new, fully original ads. Never reuse source wording. Structure: {structure}. Chosen hook line: {hook}. Brief: {brief}. Write one spoken/caption line per beat that fits its time window (~2.5 words/sec), and a concrete shot description for our AI video generator (subject, camera, setting, lighting). Keep beat roles and times exactly. Return JSON only: {"hook":{"line","visual"},"beats":[{"role","line","visual"}]}"

---

## 6. Stack & conventions

- **Runtime:** Node + TypeScript CLI (`ac`), packaged with a Claude Code skill (`/autoclone`). Python only for `faster-whisper`.
- **Media:** `ffmpeg`, `yt-dlp`, `faster-whisper` (local).
- **DB:** Supabase, table prefix **`ac_`** (`ac_brands`, `ac_ads`, `ac_structures`, `ac_clones`, `ac_analytics_events`, `ac_analytics_daily`). RLS with `auth.uid()` on user-scoped tables. Schema in PRD §4. Drop `ac_gen_cost_usd` render fields until render integration exists.
- **Demo app (Phase 2):** Next.js 14 App Router + Tailwind on Vercel, Supabase Auth via `@supabase/ssr`, `getUser()` only. Dark, data-dense, Inter + Geist Mono, ad cards with days-running badge (see prototype).
- **Env (`.env.local`):**

| Var | Status | Phase |
|---|---|---|
| `AC_DATA_SOURCE` | config, default `searchapi` | 1 |
| `SEARCHAPI_KEY` | ✅ (regenerate) | 1 |
| `APIFY_TOKEN` | ❌ optional | 2 |
| `META_ACCESS_TOKEN` | ❌ optional | 2 |
| `ANTHROPIC_API_KEY` | ✅ | 1 |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` | ❌ new project | 1 |
| `AUTOHOOK_PATH` | optional | 1 |

### Guardrails (hooks / checks)
- Table prefix `ac_` on all tables and domain columns.
- Originality guard: block `ac export` if overlap check fails.
- Source media lives only in `./.cache/sources/` (gitignored); never copied into outputs or the demo.
- Never commit keys; `.env.local` only.
- Retry with backoff on all data-source calls.
- All spend/reach figures labeled "estimated" or omitted.

### §9 config
- **Always-on skills:** /frontend-design, /vibesec, /web-dev, /backend-architect
- **Task-triggered:** data adapters → /backend-architect · media pipeline errors → /debugger · /2minvid handoff → /2minvid · micro-series briefs → /microwriter · demo UI → /frontend-developer + /visual-storyteller · phase end → /code-reviewer · launch → /project-shipper
- **Disabled MCPs:** alpaca, youtube-analytics, diffbot, replicate, seedance (render moved to Dreamina)
- **Enabled MCPs:** supabase, searchapi, exa (fallback)
- **Model routing:** default Sonnet. Opus for: initial scaffold, `structure.json` schema + break-down prompt, data-source adapter interface, originality guard, RLS.

---

## 7. Phase 1 done =
- [ ] SearchAPI test passes for huel, gymshark, ag1
- [ ] `ac spy → break → hook → adapt → export` runs end to end on one real ad in <20 min
- [ ] /2minvid renders the exported file with no manual edits
- [ ] Originality check blocks a deliberately copied script
- [ ] CLAUDE.md in repo root with skill loading block; `.claude/settings.json` with disabled MCPs; `.claude/sessions/` in `.gitignore`; `/context` > 150K

## 8. Phase 2+
Cached public demo (D5) · Apify + Meta adapters · batch mode (1 winner → 5 variants) · brand kits · competitor watchlist alerts at 30/60/90 days · shared format library.
