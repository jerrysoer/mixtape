# Commercial Break × Mixtape — testing and validation plan

**Date:** 2026-11-06 · **Content plan:** `docs/Commercial-Break-Series-Plan.md` (24-episode bank, formats F1–F14)
**Channels:** TikTok (main) and Instagram Reels (same file, cross-posted). Organic only; no paid boosts in this plan.

The plan answers three questions, in this order, with a decision gate after each stage:

1. **Does the content work?** Do strangers watch, share and follow a parody-ad series? (TikTok + IG views and engagement)
2. **Does Mixtape work as an engine?** Can it make one episode fast, cheap and with no hand fixes?
3. **Does it prove Jerry's skills?** GTM (hypothesis → experiment → decision, in public) and repo craft (a repo people star and use).

---

## 1. Hypotheses

Each one has a measure and a pass line. Pass lines are starting points: after the first 6 posts they are re-set against the account's own median.

| # | Hypothesis | Measure | Pass line (start) |
|---|---|---|---|
| H1 | The year in frame 1 + punchline by 0:02 stops the scroll | TikTok: viewers still watching at 0:02 (retention graph). IG: skip rate (share who scroll away in the first 3 s) | TikTok ≥ 70% at 0:02 · IG skip rate ≤ 40% |
| H2 | One joke in 15–25 s holds to the end | TikTok "watched full video" % · IG average watch time ÷ length | ≥ 50% full views · IG avg watch ≥ 60% of length |
| H3 | Nostalgia makes people tag friends | Shares per 1,000 views (both platforms) | ≥ 10 |
| H4 | Viewers want a series, not a one-off | Follows per 1,000 views · profile visits | ≥ 3 follows per 1,000 views |
| H5 | The audience will feed the idea queue | Comments that name a product or year | ≥ 5 per post on average by week 4 |
| H6 | Some format × decade combos clearly beat others | Median of H1–H3 per format and per decade | Top third ≥ 2× bottom third on shares/1k after 12 posts |
| H7 | The series travels beyond followers | TikTok share of views from For You · IG share of reach from non-followers | ≥ 80% (new accounts live on non-follower reach) |
| H8 | Mixtape is a real production engine | Minutes and dollars per episode, hand fixes per episode | ≤ 45 min hands-on · ≤ $2 · 0 hand fixes by episode 6 |

**What "anyone cares" means:** H1 + H3 + H4 together. Views alone can come from the feed testing a new account; holds, shares and follows can't be faked by the algorithm.

---

## 2. Test design

### 2.1 Fixed for every post (so results compare)
- Same file to both platforms: the clean MP4 from `mixtape render`, never a TikTok download (Instagram demotes watermarked video).
- Same posting slot per platform, chosen once in week 1 and held (e.g. 12:30 PM PT). TikTok first, Instagram within the same hour.
- Same structure per post: year card in frame 1, captions, end card, caption ending "Parody. Made with Mixtape.", 3–5 hashtags from one fixed set per decade.
- Length 15–25 s; one product; generic products only (series plan §9).

### 2.2 What varies (one factor at a time)
The plan's grid (14 formats × 4 decades = 56 cells) is too big for 24 posts. Test the factors one at a time instead:

| Stage | Posts | Varies | Held | Reads |
|---|---|---|---|---|
| Launch | 1–6 (Block A) | Format (6 different) | Decade mostly 1997–2004 | Which formats hook (H1) and share (H3) |
| Format round | 7–14 | Top 3 formats from launch × 2 decades | Product recognition high | Format effect vs decade effect (H6) |
| Decade round | 15–20 | Decade (70s / 80s / 90s / 00s) | Best 2 formats | Decade effect; tests the 40/30/20/10 weighting |
| Series round | 21–24 | Recurring bits (Block D) + audience pick | Best format + decade | Follows and comments (H4, H5) |

Rules:
- **Two posts per cell before judging it.** One post is noise.
- **Compare medians, not averages.** One breakout skews an average.
- **The series plan's rotation rule still applies** (no two in a row from the same decade or format) inside each stage.

### 2.3 Hook tests on Instagram Trial Reels
Instagram's Trial Reels show a Reel to non-followers first, so two hooks for the same episode can be compared without spamming the feed. Use it from post 7 on: same video, two first-frame variants (e.g. year card vs. product close-up), pick the one with the lower skip rate after 48 h, then share the winner to followers. TikTok has no organic equivalent, so TikTok runs only the winner.

### 2.4 Snapshots
Read every post at **1 h, 24 h, 72 h and 7 days**. Early numbers decide nothing on their own; the 72 h read is the one that counts for a post, the 7-day read for the gates.

---

## 3. The log

`mixtape batch` writes `validation.csv` with one row per post per platform. Claude fills metrics from TikTok Studio and Instagram insights (read in Chrome; when signed out, Claude stops and asks Jerry to log in, never logs in itself). Metrics are never estimated: a missing number stays blank.

| Column group | Columns |
|---|---|
| Episode | `ep`, `title`, `year`, `decade`, `format` (F1–F14), `product`, `hook_text`, `hook_variant`, `length_s`, `source_kind` (template / upload / spy) |
| Production (H8) | `minutes_hands_on`, `cost_usd`, `hand_fixes`, `qc_fails`, `render_version` |
| Post | `platform` (tiktok / ig), `posted_at`, `url`, `trial_reel` (y/n) |
| Read (per snapshot: 1h / 24h / 72h / 7d) | `views`, `reach`, `hold_2s_pct` (TikTok), `skip_rate_pct` (IG), `avg_watch_s`, `full_watch_pct`, `likes`, `comments`, `shares`, `saves`, `follows`, `profile_visits`, `fyp_or_nonfollower_pct` |
| Derived | `shares_per_1k`, `saves_per_1k`, `follows_per_1k`, `comments_naming_product` |

A weekly page (artifact) charts the log: views and shares/1k over time, format and decade medians, the gate status.

---

## 4. Decision gates

| Gate | When | Continue if | Change if | Stop if |
|---|---|---|---|---|
| G1 Hook | After post 6 (≈ week 2) | ≥ 3 of 6 posts pass H1 on TikTok | H1 fails on most posts: redo the first frame (year card size, motion, the joke's first word) before posting more | — |
| G2 Content | After post 12 (≈ week 3–4) | Median shares/1k ≥ 10 **or** one post ≥ 10× the account median views | Holds pass but shares don't: punchlines need to be more "tag-a-friend"; test products with stronger recognition | H1 and H3 both fail on 12 posts after a G1 fix |
| G3 Series | After post 24 (≈ week 6) | Follows/1k ≥ 3, comments feed ≥ 5 product ideas a week, top formats clear (H6) | Cut the bottom third of formats and decades (series plan §7) and run 12 more | Median views and shares flat across all 24 posts |
| G4 Engine | After post 6 and post 24 | H8 met | Fix the slowest step in Mixtape before more posts | — |

Passing G2 is the signal to start the LinkedIn "how I made it" post (series plan §6 says 3+ posts with real numbers; G2 gives stronger numbers to cite).

---

## 5. What Mixtape needs for this (feeds the build plan)

| Need | Where in the build |
|---|---|
| A built-in **format library**: F1–F14 as `structure.json` templates, so an episode needs no source ad (series plan §8 step 1 uses `spy`; a template is faster and keeps every source generic) | New: `templates/formats/F1…F14.structure.json`, written in sprint 1 next to `break` |
| An **episode file** the batch reads (one row per episode: ep, year, format, product, punchline, tone, style lock) | Sprint 6 input; Block A converts directly |
| **Era style locks** (color grade, grain, VHS / early-digital look, period props) as presets per decade | Sprint 5 (render), a `--era 1990s` preset |
| **Year card and end card** in render | Sprint 5 |
| **Original period-style music and recreated sounds** (modem, tape click), no recordings | Sprint 5; source and license per track logged |
| `validation.csv` + the weekly page | Sprint 6 |

---

## 6. Proving the skills (portfolio outputs)

The project should leave public proof of two things. Each item below is something a hiring manager or client can open.

### 6.1 GTM
| Output | Shows | When |
|---|---|---|
| This plan + the hypothesis table, published as the repo's `docs/VALIDATION-PLAN.md` | Experiment design before spending | Now |
| The weekly results page, linked from the README | Measuring honestly, including misses | From week 1 |
| Gate decisions logged in `DECISIONS.md` with the numbers behind each | Turning data into calls | At each gate |
| A case study after G3: problem, audience, the formats that won and lost, the funnel from views → follows → repo visits → stars | End-to-end GTM story | Week 6–7 |
| LinkedIn "how I made it" post, then Show HN and r/ClaudeAI posts linking the repo | Launch sequencing: audience first, product second | After G2 |
| Funnel numbers: TikTok/IG views → profile clicks → repo stars → people who render a clone | Attribution from content to product | Week 6+ |

### 6.2 Repo craft
| Output | Shows |
|---|---|
| README that opens with a 15-second Commercial Break clip and one command that makes an ad | Clear positioning and a working demo |
| `npx @jerrysoer/mixtape` quick start; `mixtape doctor` checks ffmpeg, whisper and keys | Developer experience |
| Provider interfaces (data, image, voice) with a contributor guide for adding one | Extensible design |
| Tests in CI (GitHub Actions) on every push; fixtures with fictional brands; no network needed | Engineering discipline |
| Tagged releases with a CHANGELOG, semantic versions, npm publishing from CI | Shipping habits |
| `examples/commercial-break/`: the format templates, an episode file and the rendered outputs | Real use, not a toy |
| Issue and PR templates, a good-first-issue list (new format templates, new providers) | Community readiness |
| Attribution file for code copied from MIT/Apache repos (`docs/REFERENCES.md`) | License care |

Targets for the repo, read at G3: 25+ stars in the first launch week, 10+ people who render a clone (PRD §8).

---

## 7. Risks and guardrails

- **Outside activity:** personal account, personal time. Confirm any employer outside-activity policy before the first post (series plan §9). No non-public platform data, tools or ad products; no platform comparisons. Analytics are read only from Jerry's own account, as any creator would.
- **Small numbers:** 24 posts can't prove much statistically. Decisions use medians, two posts per cell, and clear gaps (2×), not small differences.
- **New-account noise:** TikTok tests new accounts with small audiences first. Read trends over posts, not single posts.
- **Parody and IP:** generic products only, no logos, celebrities or lookalikes, no copied music or recordings, "Parody" in bio and every caption.
