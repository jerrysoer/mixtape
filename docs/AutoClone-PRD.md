# PRD: AutoClone — Find Winning Ads, Lift the Format, Rebuild With Your Stack

**Version:** 0.1 (draft)
**Date:** November 6, 2026
**Repo:** `jerrysoer/autoclone` (proposed)
**Companion repo:** `jerrysoer/autohook` (called by the `clone` module)
**Status:** Draft — confirm the ❓ items in §4 before handoff

---

## §1 — Problem & Angle

### Problem
Copying a winning creative today is three separate manual jobs:
1. **Find**: scroll the Meta Ad Library or TikTok Creative Center and guess which ads are actually working.
2. **Break down**: rewatch the winners frame by frame and write out the hook, beats, captions, and call to action.
3. **Rebuild**: rewrite it for your product, then generate and edit the assets by hand.

Tools that "spy" on ads (AdScan, Foreplay, etc.) stop after step 1. Tools that "clone" viral reels start at step 2, from a link you already picked. Nothing connects the whole loop.

### Angle
**Days running is the signal.** Brands keep paying for ads that make money, so an ad that has been live for 175+ days is close to a proven winner. AutoClone ranks ads by how long they've run and how many variants the brand made of them, not by views (which spend can buy).

AutoClone then takes the **format only**: it writes a `structure.json` template, sends the hook slot to AutoHook to optimize, writes your version, and generates it with your own stack (Replicate + Seedance), with the edit done in Remotion code.

**Positioning in one line:** Spy tools tell you what's working. AutoClone makes your version of it.

### Who it's for
DTC brands, growth marketers, and micro-series or short-form creators who make 10–100 creatives a week and want to start from proven formats instead of a blank page.

---

## §2 — Core Features (Phased)

### Phase 1 — MVP (local CLI + Claude Code skill)

| # | Feature | Acceptance criteria |
|---|---|---|
| F1 | **Spy**: fetch a brand's active ads and rank them | Given a brand name or Ad Library page ID, returns active ads with start date, days running, format (video/image/carousel), and count of near-duplicate variants. Sorted by a `ac_winner_score`. Saved to Supabase. |
| F2 | **Break down**: write `structure.json` for a chosen ad | Given a video file or URL, produces shot list (timestamps), transcript, hook text, beat roles (hook / proof / demo / CTA), caption style, and audio cues. Validates against the JSON schema. |
| F3 | **Hook**: hand off to AutoHook | Sends the hook slot plus the brief to AutoHook and writes the top 3 returned hooks back into `structure.json`. Works even if AutoHook isn't installed (falls back to 3 hooks from Claude). |
| F4 | **Adapt**: write `script.json` for your product | Given `structure.json` and a one-line brief, keeps beat count and timing within ±10%, and replaces every line and visual with new content. Originality check passes (see F6 guardrail). |
| F5 | **Generate + edit** | Generates each shot through Replicate/Seedance and the voiceover, then renders a 9:16 MP4 with Remotion. Changing one beat in `script.json` re-renders only that shot. |

**Guardrail (part of F4/F5):** no original footage, audio, exact script lines (>6-word overlap), logos, or creator likeness passes into the render. The build fails if the overlap check trips.

### Phase 2 — Polish
- Next.js dashboard: brand board (like the Huel screenshot) and a "winners" shortlist.
- Niche mode: search by keyword across brands instead of one brand.
- TikTok Creative Center Top Ads as a second source.
- Batch mode: one winner becomes 5 variants (each with a different hook from AutoHook).
- Brand kits: locked style prompt, reference image, and voice per project for consistency.

### Phase 3 — Growth
- Weekly watchlist: alert when a competitor's ad crosses 30/60/90 days running.
- Library of formats: anonymized `structure.json` templates shared across users.
- Performance loop: import your own ad results to re-weight `ac_winner_score`.
- One-click "publish to Meta" (draft ads via Marketing API).

---

## §3 — Design Direction (Phase 2 dashboard)

- **Visual mood:** data-dense, editorial. It should feel like an intelligence briefing, not a toy.
- **Reference sites:** Meta Ad Library (card grid), Foreplay (swipe file boards), Linear (density and keyboard flow).
- **Theme:** dark by default, with a toggle.
- **Typography:** modern sans (Inter or Geist) for UI; monospace (Geist Mono) for scores, days running, and spend.
- **Density:** compact. Ad cards in a 4-column grid with days running as the dominant badge.
- **Icons/illustration:** Lucide icons only. No illustrations. Ad thumbnails are the visuals.
- **Key component:** ad card with days-running badge (top-left), format icon, reach and spend in mono, and a "Clone this" button.

Use `/frontend-design` for all UI.

---

## §4 — Data & API Layer

### Sources

| Source | Format | Auth | Rate limits | Cost | Phase |
|---|---|---|---|---|---|
| **Meta Ad Library API** (`graph.facebook.com/v{version}/ads_archive`) | JSON | Meta developer app + identity verification; user access token | Graph API limits (per app/user) | Free | 1 |
| **Meta Ad Library web** (fallback) | HTML + media | None (public) | Must be polite; scraping terms to verify | Free | 1 (fallback) |
| **TikTok Creative Center Top Ads** | HTML/JSON | None for browsing | Unknown | Free | 2 |
| **yt-dlp / media download** | MP4 | None | Per site | Free | 1 |
| **Whisper** (local `faster-whisper`) | Text + timestamps | None | Local | Free | 1 |
| **Claude** (frame analysis, adapt) | JSON | `ANTHROPIC_API_KEY` | Tier-based | Paid per token (~$0.05–0.30 per ad breakdown, estimate) | 1 |
| **Replicate** (images, clips) | URLs to media | `REPLICATE_API_TOKEN` | Per account | **Paid** (roughly $0.003–0.05/image; video models cost more per clip) | 1 |
| **Seedance** (video) | URLs to media | Via your existing MCP | Per account | **Paid** | 1 |
| **ElevenLabs** (voice/SFX) | MP3 | API key | Plan-based | Free tier, then paid | 1 |
| **AutoHook** | JSON | Local | Local | Free (Claude tokens) | 1 |

❓ **Verify before build:**
1. **Meta Ad Library API coverage.** The official API fully covers political/issue ads and all ads delivered in the EU. Coverage of ordinary commercial ads outside the EU is limited. Confirm whether the fields you need (start date, media URL, active status) come back for US-only commercial ads. If not, Phase 1 spy works from EU-delivered data or the public web view.
2. **Reach and spend.** Meta doesn't publish spend for commercial ads. Any spend figure is an estimate (AdScan uses a $13 CPM). Store it as `ac_est_spend` and label it estimated in all outputs.
3. **Scraping terms** for the Ad Library web view and TikTok Creative Center.

**Phase 1 API rule:** spy, break down, and hook are free (except Claude tokens). **Generation is paid from day one** (Replicate/Seedance). That's justified because rendering is the core output. Cap spend with `AC_MAX_SPEND_PER_RUN` (default $5).

### Connection guide (Meta Ad Library API)
1. Create an app at developers.facebook.com and complete identity verification (Ad Library access).
2. Generate a user access token with ads_read.
3. Example call:
```bash
curl -G "https://graph.facebook.com/v21.0/ads_archive" \
  -d "search_page_ids=PAGE_ID" \
  -d "ad_reached_countries=['US']" \
  -d "ad_active_status=ACTIVE" \
  -d "fields=id,ad_delivery_start_time,ad_snapshot_url,ad_creative_bodies,publisher_platforms" \
  -d "access_token=$META_ACCESS_TOKEN"
```
(Check the current API version and field list in Meta's docs before building.)

### Winner score
```
ac_winner_score = 0.6 * norm(days_running)
                + 0.25 * norm(variant_count)     -- brand made copies = it works
                + 0.15 * norm(est_reach)          -- weak signal, estimated
```

### Data model — prefix `ac_`

```sql
CREATE TABLE ac_brands (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id),
  ac_name TEXT NOT NULL,
  ac_meta_page_id TEXT,
  ac_last_scanned_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE ac_ads (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  ac_brand_id UUID REFERENCES ac_brands(id) ON DELETE CASCADE,
  ac_source TEXT NOT NULL,               -- 'meta' | 'tiktok'
  ac_external_id TEXT NOT NULL,
  ac_format TEXT,                        -- 'video' | 'image' | 'carousel'
  ac_start_date DATE,
  ac_days_running INTEGER,
  ac_variant_count INTEGER DEFAULT 1,
  ac_est_reach BIGINT,
  ac_est_spend NUMERIC(12,2),            -- always estimated
  ac_media_url TEXT,
  ac_winner_score NUMERIC(5,3),
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(ac_source, ac_external_id)
);

CREATE TABLE ac_structures (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id),
  ac_ad_id UUID REFERENCES ac_ads(id),
  ac_structure JSONB NOT NULL,           -- structure.json
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE ac_clones (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id),
  ac_structure_id UUID REFERENCES ac_structures(id),
  ac_brief TEXT NOT NULL,
  ac_script JSONB NOT NULL,              -- script.json
  ac_render_url TEXT,
  ac_gen_cost_usd NUMERIC(8,2),
  ac_overlap_passed BOOLEAN,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```
Plus `ac_analytics_events` and `ac_analytics_daily` (standard schema).

**RLS:** `ac_brands`, `ac_structures`, `ac_clones` — `user_id = auth.uid()` for all operations. `ac_ads` readable by owners of the parent brand.

### Shared contract with AutoHook — `structure.json`
```json
{
  "source": { "platform": "meta", "ad_id": "...", "days_running": 286 },
  "duration_s": 24.0,
  "aspect": "9:16",
  "hook": { "t": [0, 2.5], "pattern": "contrarian_reveal", "text_role": "denies obvious answer", "candidates": [] },
  "beats": [
    { "t": [2.5, 6], "role": "problem", "visual": "talking head, close", "caption_style": "bold white, 2-line" }
  ],
  "cta": { "t": [21, 24], "type": "offer", "visual": "product hero" },
  "audio": { "music": "upbeat lo-fi", "sfx": ["whoosh at cuts"], "voice": "creator VO" }
}
```
AutoHook reads `hook` and writes `hook.candidates`. No original lines are stored in `structure.json`, only roles and patterns.

---

## §5 — Tech & Deployment

| Layer | Choice |
|---|---|
| Phase 1 runtime | Claude Code skill + Node/TypeScript CLI (`ac spy`, `ac break`, `ac clone`, `ac render`) |
| Media | `ffmpeg`, `yt-dlp`, `faster-whisper` (Python, local) |
| Edit | Remotion (React) |
| Phase 2 UI | Next.js 14+ App Router + TypeScript + Tailwind on Vercel |
| DB | Supabase (`ac_` prefix) |
| Auth | Supabase Auth (Phase 2 dashboard): email/password + magic link + GitHub OAuth, `@supabase/ssr` |
| Analytics | Supabase tables (`ac_analytics_*`) + `track()` helper + daily aggregate cron |
| Storage | Supabase Storage for renders |

**Note:** rendering runs locally in Phase 1 (Remotion and ffmpeg are heavy for Vercel functions). Phase 2 can move it to Remotion Lambda.

### Environment variables (`.env.local`)

| Variable | Status | Phase |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | ❌ new project | 1 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ❌ | 1 |
| `SUPABASE_SERVICE_ROLE_KEY` | ❌ (server only) | 1 |
| `ANTHROPIC_API_KEY` | ✅ | 1 |
| `META_ACCESS_TOKEN` | ❌ needs Meta app + ID verification | 1 |
| `REPLICATE_API_TOKEN` | ✅ | 1 |
| Seedance (via MCP) | ✅ | 1 |
| `ELEVENLABS_API_KEY` | ❌ | 1 |
| `AC_MAX_SPEND_PER_RUN` | config, default `5` | 1 |
| `AUTOHOOK_PATH` | config | 1 |

Global session and hook infrastructure (`~/.claude/settings.json`, `save-session.js`, `~/.claude/CLAUDE.md`) ✅.

---

## §6 — Success Criteria (Phase 1)

- [ ] `ac spy huel` returns ≥ 100 active ads with days running, sorted by `ac_winner_score`, in under 60 seconds.
- [ ] `ac break <ad>` produces a schema-valid `structure.json` for 9 of 10 test ads.
- [ ] `ac clone <structure> "<brief>"` produces a script within ±10% of the original's beat timing and passes the overlap check.
- [ ] `ac render` outputs a 9:16 MP4 under $5 in generation cost; editing one beat re-renders only that shot.
- [ ] End-to-end (brand name → finished MP4) in under 20 minutes.
- [ ] Every spend/reach figure in output is labeled "estimated".
- [ ] CLAUDE.md is present in project root with mandatory skill loading block
- [ ] `.claude/settings.json` exists with disabled MCPs for this project
- [ ] `.claude/sessions/` is in `.gitignore`
- [ ] Running `/context` shows effective context > 150K tokens

---

## §7 — Claude Code Skills & Agent Configuration

**Always include:** `/frontend-design`, `/vibesec`, `/code-reviewer`
**Relevant:** `/web-dev`, `/backend-architect`, `/frontend-developer`, `/visual-storyteller` (ad board, score charts), `/debugger`
**At launch:** `/project-shipper`, `/brand-guardian`
**Related:** `/video-making` (Remotion edits), `/microwriter` (adapt step for micro-series briefs)

(Mirrored in §9.1.)

---

## §8 — GTM Plan

### Positioning
FOR growth marketers and short-form creators who ship 10+ creatives a week
WHO waste hours finding winners and rebuilding them by hand
AutoClone IS A creative-cloning pipeline
THAT turns a competitor's longest-running ads into your own ready-to-post versions
UNLIKE ad spy tools (Foreplay, AdScan) that stop at research
OUR PRODUCT goes from "what's working" to a rendered video with your stack, keeping the format and none of the content.

**One-liner:** AutoClone helps marketers ship proven ad formats by finding competitors' longest-running ads and rebuilding them with AI.

**Why now:** spy-to-Claude posts (like the Huel AdScan demo) show demand for ad intelligence inside Claude. Video models (Seedance and others) are now good enough to rebuild a format end to end. Nobody has joined the two.

**Competitive alternatives:**
1. Foreplay / AdScan: research only. AutoClone produces the creative.
2. Viral-reel cloner skills: start from a link you already found. AutoClone finds the winners.
3. Agencies/UGC creators: days per creative. AutoClone: minutes.

**Category:** adjacent to "ad spy tools"; repositioned as "creative production from proven formats."

### Market fit signals
Use the standard table: 200+ organic visitors in week 1, 30%+ interact, 60s+ average session, 3+ unprompted shares, one post with 20+ upvotes. Add: **25+ GitHub stars in week 1** and **10+ people who render a clone**.

### Channels
1. **LinkedIn**: "I fed Claude a competitor's 286-day-old ad. Here's the version it made." Before/after video.
2. **X**: demo clip + repo link to the AI-video and Claude Code crowd.
3. **r/ClaudeAI, r/PPC, r/FacebookAds**: workflow post with an honest estimated-spend caveat.
4. **Show HN**: open-source pipeline angle.
5. **Product Hunt**: once the Phase 2 dashboard exists.

### ICP validation gate
1. Find 3 threads where marketers complain about manually recreating competitor ads.
2. Get 5+ marketers to run the CLI on their own competitor.
3. Explain it without jargon: "It finds the ads your competitors keep paying for and makes your own version."

---

## §9 — CLAUDE.md Configuration

### §9.1 — Skill Loading

#### Always-On
- /frontend-design
- /vibesec
- /web-dev
- /backend-architect

#### Task-Triggered
| Task | Skill |
|---|---|
| Meta / TikTok fetch + winner score | /backend-architect |
| Remotion composition and edit logic | /video-making + /frontend-developer |
| Ad board UI, score charts (Phase 2) | /visual-storyteller + /frontend-developer |
| Micro-series brief adaptation | /microwriter |
| Mobile layout pass | /mobile-ux-optimizer |
| Errors in media pipeline | /debugger |
| Phase completion | /code-reviewer |
| Launch week | /project-shipper + /brand-guardian |

### §9.2 — Disabled MCPs
- alpaca (no trading)
- youtube-analytics (not a Phase 1 source)
- diffbot (not needed; Ad Library has an API)

**Enabled:** supabase, replicate, seedance, searchapi (brand lookup), exa (fallback lookup for niche mode).

### §9.3 — Model Routing
**Default: Sonnet**

**Use Opus for:**
- Initial scaffold from this PRD
- `structure.json` schema and the AutoHook contract
- The break-down prompt (frame analysis → beat roles)
- The overlap/originality guardrail
- Auth/RLS policy design (Phase 2)

### §9.4 — Verification Hooks
Global hooks apply. Additional project-specific checks:
- [ ] Table prefix hook: all tables and domain columns use `ac_`
- [ ] Spend guard: warn if any Replicate/Seedance call path skips `AC_MAX_SPEND_PER_RUN`
- [ ] Originality guard: block render if `ac_overlap_passed` is false
- [ ] Retry check: generation calls must have retry + backoff
- [ ] Media hygiene: downloaded source media lives in `./.cache/sources/`, is gitignored, and is never copied into `./renders/`

---

## Open questions
1. Does the Meta API return start dates and media for US-only commercial ads? (Decides the Phase 1 spy source.)
2. Is AutoHook built yet, or should Phase 1 ship with the Claude fallback only?
3. Is there an outside-activity policy issue with publicly launching a tool that analyzes ads?
