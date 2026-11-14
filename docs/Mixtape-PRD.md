# PRD: Mixtape - Clone a Proven Ad Format Into Your Own Ad

**Version:** 0.2
**Date:** November 6, 2026
**Repo:** `jerrysoer/mixtape` · **npm:** `@jerrysoer/mixtape` · **Skill:** `/mixtape` · **CLI:** `mixtape` (alias `mx`)
**Supersedes:** `docs/AutoClone-PRD.md` (v0.1, kept as history) and `docs/AutoClone-Handoff.md` where they differ
**Companion repo:** `jerrysoer/autohook` (optional, called by the hook step)
**Status:** Build-ready. Two open questions in the last section, both due before the render-run sprint.

---

## Changes since v0.1

| Change | Why | Source |
|---|---|---|
| Renamed AutoClone to Mixtape. Prefixes: `mx_`, `MX_`, CLI `mixtape`/`mx`. | Owner's pick, made before any code existed. | DECISIONS 2026-11-06 (rename) |
| Showcase is cloning a proven format, not finding the best ads. | Days running is strong for Huel, weak for Gymshark and AG1. Owner wants to show the cloning. | DECISIONS 2026-11-06 (cloning first) |
| Source is a mode. Core: upload, link or describe. Add-on: `spy`. | Lets users start with manual input. No data-source key needed for core. | DECISIONS 2026-11-06 (bring-your-own source) |
| Meta only. No TikTok anywhere. | One ad library, one data contract. | Handoff D1 |
| Data source swappable. SearchAPI default. Apify and official Meta API as later adapters. | Official API returns EU-delivered ads only and needs ID verification. | Handoff D2, D3 |
| Open source, bring your own key. | No hosted paid version on the owner's credentials. | Handoff D4 |
| Phase 2 public demo is a cached snapshot. | No free-text brand search through the owner's key. | Handoff D5 |
| Render is built in (`mixtape render`). Replicate, Seedance and Remotion dropped. /2minvid is not used or changed. | /2minvid enforces the 2-minute recap format. Open-source users will not have it. | DECISIONS 2026-11-06 (render inside Mixtape); replaces Handoff D6 |
| One approved quote per clone, ceiling `MX_MAX_SPEND_PER_RUN`. | Nothing paid runs by accident. | DECISIONS 2026-11-06 (plan answers) |
| Mac first: every sprint built and tested locally; the claude.ai test bench is an optional playground, not a gate. | Only the Mac runs the full pipeline (ffmpeg, whisper, ElevenLabs, Dreamina); the CLI is the product. | DECISIONS 2026-11-06 (Mac first) |
| First real use is validation: a batch of ads from Jerry's content plan, run to see if anyone cares. Batch mode moves from Phase 2 into Phase 1. | Test demand with real ads before polish, demo or hosting. | DECISIONS 2026-11-06 (validation) |
| Supabase is files-only until the spy sprint. | Cloning needs no database. | DECISIONS 2026-11-06 (plan answers) |
| SearchAPI facts replace v0.1 and handoff assumptions (30 ads per call, both video URL shapes, direct expiring MP4s, page ID search, `collation_count`, no reach). | Step 2 test results. | DECISIONS 2026-11-06 (SearchAPI facts); PLAN §4 |
| Hooks: 10 generated, scored, top 5 kept. AutoHook optional. | Proven in the prototype. | Handoff D7 |
| Reach weight is 0 for Meta commercial ads. Score is ranked within brand. | `impressions_index` is -1. | Handoff D8; PLAN §4 |
| `script.json` adds schema-2 shot slots per beat and `claims_in_brief`. | Render needs shot detail. Proof lines may only use brief facts. | EXPORT-CONTRACT; PLAN sprint 3 |
| `mx_gen_cost_usd` stays in `mx_clones`. Added `mx_source_kind` to `mx_structures`. | Render is now in scope. Core sources are not ads from a library. | This PRD |
| §3 drops Inter. Fonts chosen at design time. | Owner bans Inter, Roboto and system fonts. | Global design rules |
| Success criteria rewritten. `/context` item dropped. | New scope. | This PRD |
| Skills follow the project CLAUDE.md mapping. Only `/vibesec` is always on. | v0.1 listed skills that are not installed. | CLAUDE.md |
| Outside-activity approval left out. | Out of scope. | PLAN §5 |

---

## §1: Problem & Angle

### Problem
Copying a proven ad format is three manual jobs:
1. **Source**: find an ad worth copying, or already have one.
2. **Break down**: rewatch it frame by frame and write out the hook, beats, captions and call to action.
3. **Rebuild**: rewrite it for your product, then make the voice, visuals and edit by hand.

Ad spy tools (Foreplay, AdScan) stop after step 1. Reel cloners start at step 2 from a link you picked, and stop before an edit you can post. Nothing joins the loop and ends in a finished video.

### Angle
**The showcase is the clone.** Give Mixtape an ad you know works. It lifts the format only, writes your version, and renders it. Every line, shot and sound is new.

Source is a mode:
- **Core (free):** bring your own ad. Upload a video, link to one, or self-source: describe the format or paste a transcript.
- **Add-on, `spy`:** pull a brand's active ads from Meta ad libraries with your own data-source key (SearchAPI by default) and pick a long-running one.

Days running is still the best winner signal when you use `spy`. It is not the product's pitch.

**Positioning in one line:** Spy tools tell you what is working. Mixtape makes your version of it.

### Who it's for
DTC brands, growth marketers, and short-form creators who make 10 to 100 creatives a week and want to start from a proven format instead of a blank page.

---

## §2: Core Features (Phased)

**Pipeline:** `source → break → hook → press → render`. With the add-on: `spy → pick → break → hook → press → render`.

### Phase 1 - MVP (CLI + Claude Code skill)

| # | Feature | Command | Acceptance criteria |
|---|---|---|---|
| F0 | **Test bench (optional)**: claude.ai artifact runs source → break → hook → press and downloads both JSON files. A prompt playground, not a gate. | n/a | Published: https://claude.ai/artifact/1WQUobPSJCoj6DAKrQSq9X |
| F1 | **Source (core)**: upload a file, link, or describe the format (optionally with a transcript). | `mixtape break <file\|url>` or `mixtape break --describe "<format>" [--transcript file]` | Media stays in `.cache/sources/`. A described format works with no media. |
| F2 | **Break down**: write `structure.json`. | `mixtape break` | Scene cuts (ffmpeg), transcript (faster-whisper, cache only), keyframes, Claude. Schema-valid for 9 of 10 test ads. Roles and patterns only. |
| F3 | **Hook**: 10 hooks in the structure's pattern, scored, top 5 kept in `hook.candidates`. | `mixtape hook <structure>` | 5 ranked hooks. AutoHook is used if `AUTOHOOK_PATH` is set. Template fallback works offline. |
| F4 | **Press**: write `script.json` for your product. | `mixtape press <structure> "<brief>"` | Same roles, timing within ±10%. One line and schema-2 shot slots per beat. Originality guard passes. |
| F5 | **Render**: voiceover with word timings, AI stills, ffmpeg assembly with word captions, QC. | `mixtape render <script>` | 9:16 MP4 with no manual edits, under `MX_MAX_SPEND_PER_RUN`. Every paid call is quoted and approved first. |
| F6 | **Spy (add-on)**: fetch a brand's active ads and rank them. | `mixtape spy <brand>` | ≥100 ads for a global brand in under 60 s, ranked within brand by `mx_winner_score`. Saved to `./data/<brand>.json` and Supabase. |
| F7 | **Batch + validation pack**: a content plan becomes one brief per row, then N scripts and renders from one pack quote, plus `validation.csv` (ad id, hook, format, brief, post link, metrics blank). | `mixtape batch <plan>` | First 5 rows render from one approved quote. Nothing is posted automatically. |
| F8 | **Skill**: `/mixtape` SKILL.md says when to call each command and where the approve gates are. | n/a | Full run on one real ad in under 20 minutes. |

**Render details (F5):**
- Plan first: `script.json` becomes a shot list (format in `docs/EXPORT-CONTRACT.md`), a free voice dry run, and image prompts. It then prints one **quote** (voice + stills, credits and dollars) and stops.
- Run: nothing is billed without `mixtape render <script> --approve <quote-id>`. The quote total must be at or under `MX_MAX_SPEND_PER_RUN` (default $5), or the run refuses.
- Providers are swappable: `MX_IMAGE_SOURCE` (default `dreamina`), `MX_VOICE_SOURCE` (default `elevenlabs`; free Mac `say` placeholder for dry runs).
- Assembly: moves, word-by-word captions, end card, loudness to -14 LUFS. QC: frame check and anatomy check, verdicts written next to the MP4.
- Output: `renders/<slug>/out/<slug>.mp4`.
- Expected cost per ad: about 5 to 8 stills at 12 credits each (about $0.55 to $0.90) plus about $0.03 of narration. Check against the live credit rate when quoting.
- `mixtape export` is an internal step of render, not a handoff.

**Guardrail (F4/F5):** no original footage, audio, script lines (any run of more than 6 shared words), logos or creator likeness passes into the render. `render` refuses if the originality check fails. Proof and claim lines may only use facts from the brief (`checks.claims_in_brief`).

### Phase 2 - Polish
- Cached public demo: 5 to 10 pre-pulled global brands in Supabase, no free-text brand search, live Claude for hook and press (rate-limited), pre-rendered example clones, call to action "clone the repo for any brand." Next.js dashboard with a brand board and winners shortlist (D5).
- `spy` adapters for Apify and the official Meta API. Maybe a hosted spy service later.
- Niche mode: search by keyword across brands.
- Brand kits: locked style prompt, reference image and voice per project.
- Per-shot re-render with a cost readout.

### Phase 3 - Growth
- Weekly watchlist: alert when a competitor's ad crosses 30, 60 or 90 days running.
- Shared library of anonymized `structure.json` formats.
- Performance loop: import your own ad results to re-weight the score.
- One-click draft to Meta via the Marketing API.

---

## §3: Design Direction (Phase 2 dashboard)

- **Visual mood:** data-dense, editorial. An intelligence briefing, not a toy.
- **Reference sites:** Meta Ad Library (card grid), Foreplay (swipe file boards), Linear (density and keyboard flow).
- **Theme:** dark by default, with a toggle.
- **Typography:** chosen at design time. Not Inter, Roboto or system fonts. A monospace face for scores, days running and spend.
- **Density:** compact. Ad cards in a 4-column grid with days running as the dominant badge.
- **Icons and imagery:** Lucide icons only. No illustrations. Ad thumbnails are the visuals.
- **Key component:** ad card with days-running badge (top-left), format icon, estimated reach and spend in mono (when available), and a "Clone this" button.

Phase 1 has no UI. Load `/frontend-design` when Phase 2 starts. A `DESIGN.md` is created then.

---

## §4: Data & API Layer

### Sources

| Source | Auth | Cost | Phase |
|---|---|---|---|
| **Uploaded video, link, or described format** (core) | None | Free | 1 |
| **SearchAPI** `engine=meta_ad_library` (default `spy` source) | `SEARCHAPI_KEY` (user's own) | Per search credit, 30 ads per call | 1, add-on |
| **Apify** Ad Library scrapers | `APIFY_TOKEN` | About $0.30 to $1.00 per 1,000 ads | 2 |
| **Official Meta Ad Library API** | Meta app, ID verification, `META_ACCESS_TOKEN` | Free. EU-delivered commercial ads only. Terms reportedly bar reselling. | 2 |
| **Whisper** (local `faster-whisper`) | None | Free | 1 |
| **ffmpeg** | None | Free | 1 |
| **Claude** (frame analysis, hook, press) | `ANTHROPIC_API_KEY` | Per token (about $0.05 to $0.30 per ad breakdown, estimate) | 1 |
| **Dreamina** (stills, default `MX_IMAGE_SOURCE`) | Existing Dreamina setup | Paid, quoted first | 1 |
| **ElevenLabs** (voice, default `MX_VOICE_SOURCE`) | `ELEVENLABS_API_KEY` | Free tier, then paid, quoted first | 1 |
| **AutoHook** | Local path | Free (Claude tokens) | 1, optional |

yt-dlp is not used. Replicate, Seedance and Remotion are dropped.

**Phase 1 API rule:** source, break, hook and press cost only Claude tokens. Render is paid. Every paid call comes from one quote per clone (voice + stills), under the ceiling `MX_MAX_SPEND_PER_RUN` (default $5), and nothing runs without `--approve <quote-id>`.

### SearchAPI facts (tested 2026-11-06)

| Fact | Detail |
|---|---|
| Page size | 30 ads per call, with `next_page_token` (can exceed 8 KB, so POST) |
| `start_date` | Present on every ad |
| Video URLs | In `snapshot.videos[]` (VIDEO format) or `snapshot.cards[].video_hd_url` (DCO format). Read both. |
| Download | Direct signed MP4 links that expire. Fetch at `break` time. No yt-dlp. |
| Search | By verified `page_id`, never keyword. Keyword search mixes in resellers and wrong advertisers ("ag1" does not find AG1). |
| Sort | By impressions only. No sort by age. Paginate fully, sort locally. |
| Variants | `collation_count` is Meta's own variant grouping. Clustering by text, duration and frame hash is a fallback only. |
| Reach | `impressions_index` is -1. No reach data for commercial ads. |
| Days running as a signal | Strong for Huel (10 active video ads at 175+ days). Weak for Gymshark (oldest 37 days in the top 30) and AG1 (107 days). So rank within brand, not by fixed day thresholds. |
| MCP | Inline responses cap near 80 KB. The returned `full_result_url` can be fetched without auth. |

Reach and spend: Meta publishes neither for commercial ads. Any spend figure is an estimate and is labeled "estimated" or omitted. Never rank by views or estimated spend.

### Winner score
```
mx_winner_score = 0.6  * norm(days_running)
                + 0.25 * norm(variant_count)     -- collation_count: brand made copies = it works
                + 0.15 * norm(est_reach)         -- weight 0 when unavailable (always, for Meta commercial ads)
```
When reach is unavailable, drop its weight to 0 and renormalize the other two. Normalize and rank **within a brand**.

### Data model - prefix `mx_`

Files-only until the spy sprint. The migration lands then.

```sql
CREATE TABLE mx_brands (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id),
  mx_name TEXT NOT NULL,
  mx_meta_page_id TEXT,
  mx_last_scanned_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE mx_ads (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  mx_brand_id UUID REFERENCES mx_brands(id) ON DELETE CASCADE,
  mx_source TEXT NOT NULL,               -- 'meta' | 'upload' | 'link' | 'describe'
  mx_external_id TEXT NOT NULL,
  mx_format TEXT,                        -- 'video' | 'image' | 'carousel' | 'dco'
  mx_start_date DATE,
  mx_days_running INTEGER,
  mx_variant_count INTEGER DEFAULT 1,
  mx_est_reach BIGINT,                   -- null for Meta commercial ads
  mx_est_spend NUMERIC(12,2),            -- always estimated, usually null
  mx_media_url TEXT,                     -- signed and expiring; never the stored copy
  mx_winner_score NUMERIC(5,3),
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(mx_source, mx_external_id)
);

CREATE TABLE mx_structures (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id),
  mx_ad_id UUID REFERENCES mx_ads(id),   -- null for upload, link or describe sources
  mx_source_kind TEXT NOT NULL,          -- 'meta' | 'upload' | 'link' | 'describe'
  mx_structure JSONB NOT NULL,           -- structure.json
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE mx_clones (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id),
  mx_structure_id UUID REFERENCES mx_structures(id),
  mx_brief TEXT NOT NULL,
  mx_script JSONB NOT NULL,              -- script.json
  mx_render_url TEXT,
  mx_gen_cost_usd NUMERIC(8,2),
  mx_overlap_passed BOOLEAN,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```
Plus `mx_analytics_events` and `mx_analytics_daily` (standard schema).

**RLS:** `mx_brands`, `mx_structures`, `mx_clones` use `user_id = auth.uid()` for all operations. `mx_ads` is readable by owners of the parent brand. Use `getUser()`, never `getSession()`, on the server.

### Contracts

**`structure.json`** (shared with AutoHook). Roles and patterns only.
```json
{
  "source": { "platform": "meta", "kind": "meta", "ad_id": "…", "page_name": "…", "days_running": 286, "variants": 14 },
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
  "rules": "roles and patterns only - no original lines, footage, audio or likeness"
}
```
For `upload`, `link` and `describe` sources, `source.kind` is that value and the ad-library fields (`ad_id`, `days_running`, `variants`) are omitted.

Hook patterns: `contrarian_reveal`, `stop_doing_x`, `pov`, `day_in_life`, `number_shock`, `sensory`, `myth_bust`, `announcement`, `testimonial`. Format patterns are listed in Extras §1.

**`script.json`**
```json
{
  "brief": "…",
  "hook": { "t": [0, 2.5], "line": "…", "visual": "…" },
  "hook_candidates": ["…"],
  "beats": [
    {
      "t": [2.5, 7], "role": "problem", "line": "…",
      "visual": "…",
      "shot": { "time": "…", "camera": "…", "people": "…", "extras": "…", "wear": "…", "state": "…" }
    }
  ],
  "style_lock": { "style_prompt": "…", "reference_image": "path or url" },
  "checks": { "overlap_passed": true, "timing_within_10pct": true, "claims_in_brief": true }
}
```
Each beat carries the schema-2 shot slots (`time`, `camera`, `people`, `extras`, `wear`, `state`), not one sentence. The shot list that render builds from `script.json` is defined in `docs/EXPORT-CONTRACT.md`. That file was written as a /2minvid handoff proposal. Use its field mapping and shot-slot rules, and ignore its "needs an `ad` profile in /2minvid" section, which no longer applies.

### Proven prompts (from the handoff, kept as is)

**Hook:** "You are a short-form ad hook writer. Write 10 original hooks (max 12 words each) for this topic: {topic}. They must follow this hook pattern from a proven long-running ad: {pattern} (role: {text_role}). Format of the source ad: {format}. Score each 1-10 on scroll, curiosity, fit. Be a harsh judge; spread scores. Return JSON only: {"hooks":[{"text","scroll","curiosity","fit"}]}"

Final hook score = `0.45·scroll + 0.35·curiosity + 0.2·fit`. Keep the top 5.

**Press:** "You adapt proven ad FORMATS into new, fully original ads. Never reuse source wording. Structure: {structure}. Chosen hook line: {hook}. Brief: {brief}. Write one spoken/caption line per beat that fits its time window (~2.5 words/sec), and a concrete shot description for our AI video generator (subject, camera, setting, lighting). Keep beat roles and times exactly. Return JSON only: {"hook":{"line","visual"},"beats":[{"role","line","visual"}]}"

The press prompt must now also return the schema-2 shot slots per beat. Extend it in Sprint 3.

---

## §5: Tech & Deployment

| Layer | Choice |
|---|---|
| Phase 1 runtime | Node + TypeScript (strict) CLI: `mixtape break`, `hook`, `press`, `render`, `spy`. Alias `mx`. Packaged with the `/mixtape` Claude Code skill. Published as `@jerrysoer/mixtape`. |
| Media | `ffmpeg`, `faster-whisper` (Python, local, transcription only) |
| Providers | Small interfaces picked by env var: data source, image, voice. Each adapter retries with backoff, caches under `.cache/`, never logs keys. |
| Render | Built in. No Remotion. No Replicate or Seedance. |
| Phase 2 UI | Next.js App Router + TypeScript + Tailwind on Vercel |
| DB | Supabase (`mx_` prefix), from the spy sprint. No env vars means files only. |
| Auth | Supabase Auth (Phase 2 dashboard): email/password + magic link + GitHub OAuth, `@supabase/ssr` |
| Analytics | Supabase tables (`mx_analytics_*`) + `track()` helper + daily aggregate cron |
| Storage | Local `renders/` in Phase 1. Supabase Storage in Phase 2. |

Rendering runs locally. ffmpeg is too heavy for Vercel functions.

### Build order

Each sprint ends with `npm run build`, `npm run lint`, `npx tsc --noEmit` and `npm test` passing, then a stop for the owner.

| Sprint | Delivers | Done when |
|---|---|---|
| 0 | CLI scaffold: repo, TS strict, `mixtape` + `mx` bin, config loader, `.env.local`, Vitest, fixtures | `mx --help` lists every command. Tests run. |
| 1 | `break` | Schema-valid for the Huel sample plus 4 more saved ads. No source line in output. |
| 2 | `hook` | 5 ranked hooks. Offline template fallback works. |
| 3 | `press` + originality guard | Timing ±10%. A copied script is blocked. Proof lines use brief facts only. |
| 4 | `render` plan + quote | Quote shows credits and dollars. Nothing billed without `--approve`. |
| 5 | `render` run + build + QC | MP4 with no manual edits. QC verdicts written. Needs the narrator voice and default look. |
| 6 | `batch` + validation pack | First 5 rows of the content plan render from one approved quote; `validation.csv` written. Needs the content plan. |
| 7 | `spy` (add-on) + Supabase | ≥100 Huel ads in under 60 s, ranked within brand. Needs a valid `SEARCHAPI_KEY`. |
| 8 | Skill + end to end | Upload → break → hook → press → render on one real ad in under 20 minutes. |

Everything is built and tested on the owner's Mac first. The public demo (artifact or Vercel) and Supabase follow validation.

Sprints 1 to 6 run on uploaded or saved ads, so the data-source key is only needed in Sprint 7.

### Environment variables (`.env.local` only)

| Variable | Status | Phase |
|---|---|---|
| `MX_DATA_SOURCE` | config, `searchapi` (default) \| `apify` \| `meta` | 1, spy add-on |
| `SEARCHAPI_KEY` | needed for `spy` only. Regenerate the old key. | 1, spy add-on |
| `ANTHROPIC_API_KEY` | ✅ | 1 |
| `MX_IMAGE_SOURCE` | config, default `dreamina` | 1 |
| `MX_VOICE_SOURCE` | config, default `elevenlabs`. `say` is the free Mac placeholder. | 1 |
| `ELEVENLABS_API_KEY` | ❌ | 1 |
| `MX_MAX_SPEND_PER_RUN` | config, default `5` | 1 |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` | ❌ new project, spy sprint | 1 |
| `AUTOHOOK_PATH` | optional | 1 |
| `APIFY_TOKEN` | ❌ optional | 2 |
| `META_ACCESS_TOKEN` | ❌ optional | 2 |

`REPLICATE_API_TOKEN` is removed. `SUPABASE_SERVICE_ROLE_KEY` is server only.

---

## §6: Success Criteria (Phase 1)

- [ ] **Validation pack:** `mixtape batch` turns the first 5 rows of the content plan into MP4s from one approved quote, with `validation.csv`.
- [ ] **Break:** `mixtape break` produces a schema-valid `structure.json` for 9 of 10 test ads, with no source line in the output.
- [ ] **Hooks:** `mixtape hook` returns 10 scored hooks and keeps the top 5, ranked by `0.45·scroll + 0.35·curiosity + 0.2·fit`. The template fallback works offline.
- [ ] **Press:** `mixtape press` keeps beat timing within ±10% of the source. The originality guard blocks a deliberately copied script (a run of more than 6 shared words).
- [ ] **Render:** `mixtape render` produces a 9:16 MP4 with voiceover, stills and word captions, no manual edits, under `MX_MAX_SPEND_PER_RUN`. It refuses to run without `--approve <quote-id>`.
- [ ] **Spy (add-on):** `mixtape spy huel` returns ≥100 active ads with days running, ranked within brand, in under 60 seconds.
- [ ] **End to end:** one real ad to a finished MP4 in under 20 minutes.
- [ ] Every spend and reach figure in output is labeled "estimated" or omitted.
- [ ] CLAUDE.md is in the project root with the skill loading block. `.claude/settings.json` exists with disabled MCPs. `.claude/sessions/` is in `.gitignore`.

---

## §7: Claude Code Skills & Agent Configuration

Uses the installed-skill mapping in the project's `CLAUDE.md`.

**Always on:** `/vibesec` (every command touches keys, external APIs or untrusted ad text).

**Task-triggered:**

| If the task touches... | Load |
|---|---|
| Data-source adapters, CLI architecture, Supabase schema | `/supabase`, `/typescript-expert` |
| ffmpeg or whisper errors, any failing step | `/debugging` |
| Render step | Read `/2minvid` for patterns only. Never call or edit it. |
| Micro-series briefs for `mixtape press` | `/microwriter` |
| Tests | `/testing` |
| Phase 2 demo UI | `/frontend-design`, `/nextjs`, `/visuals` |
| End of a phase | `/code-review` |
| Launch | `/ship` |

(Mirrored in §9.1.)

---

## §8: GTM Plan

### Positioning
FOR growth marketers and short-form creators who ship 10+ creatives a week
WHO waste hours rebuilding proven ad formats by hand
Mixtape IS an open-source ad-cloning pipeline
THAT turns any ad you bring (or a competitor's long-running ad you find) into your own ready-to-post video
UNLIKE ad spy tools (Foreplay, AdScan) that stop at research
OUR PRODUCT keeps the format and none of the content, and renders the result.

**One-liner:** Mixtape clones a proven ad format into your own ad, then renders it.

**Why now:** spy-to-Claude posts (like the Huel AdScan demo) show demand for ad intelligence inside Claude. Image and voice models are good enough to rebuild a format end to end. Nobody has joined the two.

**Competitive alternatives:**
1. Foreplay / AdScan: research only. Mixtape produces the creative.
2. Viral-reel cloner skills: start from a link and stop before a finished edit. Mixtape renders the video and guards originality.
3. Agencies and UGC creators: days per creative. Mixtape: minutes.

**Category:** adjacent to "ad spy tools"; positioned as "creative production from proven formats."

### Market fit signals
200+ organic visitors in week 1, 30%+ interact, 60 s+ average session, 3+ unprompted shares, one post with 20+ upvotes. Add **25+ GitHub stars in week 1** and **10+ people who render a clone**.

### Channels
1. **LinkedIn:** before/after video of a clone built from a long-running ad.
2. **X:** demo clip and repo link for the AI-video and Claude Code crowd.
3. **r/ClaudeAI, r/PPC, r/FacebookAds:** workflow post with an honest estimated-spend caveat.
4. **Show HN:** open-source pipeline angle.
5. **Product Hunt:** once the Phase 2 dashboard exists.

### Demo and disclosure (Phase 2)
Cached snapshot of 5 to 10 global brands (Huel, Gymshark and AG1 tested first). Copy: "Data from the Meta Ad Library" and "not affiliated with these brands." Show clones beside links to the originals. Never re-host brand videos. When using EU-delivered data, prefer English-language EU markets (Ireland) and use the structure, not the offer or pricing.

### Monetization (later, not decided)
If ever paid: charge for clone, hook or render with customers using their own keys, or add a hosted `spy` service on licensed data. Read Meta's access terms and get a short legal review before charging. No hosted version on the owner's credentials (D4).

### ICP validation gate
1. Find 3 threads where marketers complain about manually recreating competitor ads.
2. Get 5+ marketers to run the CLI on an ad of their own.
3. Explain it without jargon: "Give it an ad that works. It makes your own version."

---

## §9: CLAUDE.md Configuration

### §9.1 - Skill Loading
See §7. Only `/vibesec` is always on. Everything else loads by task, per the table in the project's `CLAUDE.md`.

### §9.2 - Disabled MCPs
- alpaca (no trading)
- youtube-analytics (not a source)
- diffbot (not needed)
- replicate, seedance (dropped)
- tiktok-ads and any TikTok tools (Meta only, D1)

**Enabled:** supabase (spy sprint), searchapi (interactive pulls and brand lookup), exa (fallback lookup).

### §9.3 - Model Routing
**Default: Sonnet.**

**Use Opus for:**
- Initial scaffold
- `structure.json` schema and the break-down prompt
- The data-source adapter interface
- The originality guard
- The render anatomy QC pass
- RLS policy design

### §9.4 - Verification Hooks
Global hooks apply. Project-specific checks:
- [ ] Table prefix: all tables and domain columns use `mx_`.
- [ ] Spend guard: every paid call path goes through a quote and `--approve <quote-id>`, and respects `MX_MAX_SPEND_PER_RUN`.
- [ ] Originality guard: `render` refuses when `overlap_passed` is false.
- [ ] Claims guard: proof and claim lines come only from the brief.
- [ ] Retry check: data-source and generation calls have retry with backoff.
- [ ] Media hygiene: source media lives only in `./.cache/sources/`, is gitignored, and is never copied into `./renders/` or a demo.
- [ ] Keys: none in commits. `.env.local` only.
- [ ] Labels: spend and reach figures are marked "estimated" or omitted.
- [ ] Fixtures: only the fictional brands Fuelwell and Northpeak Sleep. Real brand names appear only in live data pulls.

---

## Open questions

1. **Narrator voice.** Which ElevenLabs voice is the default? Decide before the render-run sprint (Sprint 5). Sprint 4 uses the free Mac voice for dry runs.
2. **Default clone look.** What is the default image style? Decide before Sprint 5. Until then `style_lock` must be set per script.

3. **Content plan:** supplied (`docs/Commercial-Break-Series-Plan.md`). Validation: `docs/VALIDATION-PLAN.md` (TikTok + IG Reels, organic, hypotheses H1–H8, gates G1–G4).
4. **Project goal:** Mixtape is also Jerry's public proof of GTM skill (experiments, decisions and a launch run in the open) and repo craft (README demo, CI, releases, docs, contributor path). See VALIDATION-PLAN §6.

Product name is decided (Mixtape).
