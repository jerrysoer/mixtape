# AutoClone — Extras (not in AutoClone-Handoff.md)

**Date:** November 6, 2026
**Use:** Supplementary context for Claude Code. AutoClone-Handoff.md is the source of truth for decisions; this file holds the material it leaves out.

---

## 1. Prototype sample data

The prototype (claude.ai artifact "AutoClone Prototype") uses **mock ads for fictional brands only**. Do not replace them with real brand names in any demo fixture; real brands come only from live data-source pulls.

### Mock brands and ads
| Brand | ID | Format | Days | Variants | Est. reach | Title | Format pattern | Hook pattern |
|---|---|---|---|---|---|---|---|---|
| Fuelwell | fw1 | Video | 286 | 14 | 2.1M | Gym floor product toss | demo_in_context | contrarian_reveal |
| Fuelwell | fw2 | Video | 253 | 9 | 870k | Founder: 'stop doing this' | founder_talking_head | stop_doing_x |
| Fuelwell | fw3 | Video | 234 | 11 | 1.1M | POV: lazy but trying | pov_relatable | pov |
| Fuelwell | fw4 | Video | 175 | 6 | 1.7M | Creator morning routine | creator_routine | day_in_life |
| Fuelwell | fw5 | Image | 142 | 22 | 640k | Price-per-meal compare | comparison_static | number_shock |
| Fuelwell | fw6 | Video | 61 | 3 | 410k | Unboxing ASMR | asmr_unbox | sensory |
| Fuelwell | fw7 | Carousel | 38 | 2 | 220k | 5 myths about protein | listicle | myth_bust |
| Fuelwell | fw8 | Video | 12 | 1 | 95k | New flavor launch | launch | announcement |
| Northpeak Sleep | np1 | Video | 311 | 18 | 3.0M | 'Your pillow is lying' | founder_talking_head | contrarian_reveal |
| Northpeak Sleep | np2 | Video | 198 | 7 | 1.2M | Sleep score before/after | before_after | number_shock |
| Northpeak Sleep | np3 | Image | 120 | 15 | 500k | Customer review collage | social_proof | testimonial |
| Northpeak Sleep | np4 | Video | 44 | 2 | 300k | 3am wake-up POV | pov_relatable | pov |

Useful as unit-test fixtures for `ac_winner_score` and ranking.

### Format patterns (beyond handoff)
`demo_in_context`, `founder_talking_head`, `pov_relatable`, `creator_routine`, `comparison_static`, `asmr_unbox`, `listicle`, `launch`, `before_after`, `social_proof`

### Template hook fallbacks (used when Claude is unavailable)
`{x}` = topic lowercase, `{X}` = topic capitalized.
```json
{
 "contrarian_reveal": ["The best {x} isn't the one you think.","Everyone's wrong about {x}.","{X} experts won't tell you this."],
 "stop_doing_x": ["Stop doing {x} like this.","You've been doing {x} wrong.","Quit {x} until you see this."],
 "pov": ["POV: you want {x} but you're lazy.","POV: you finally fixed {x}.","POV: {x} at 7am."],
 "day_in_life": ["My {x} routine that actually stuck.","What {x} looks like on a busy day.","I tried {x} every day for a week."],
 "number_shock": ["{X} for less than a coffee.","This saved me 4 hours of {x}.","90% of people get {x} wrong."],
 "sensory": ["Just listen to this {x}.","The most satisfying {x} ever.","Turn sound on for {x}."],
 "myth_bust": ["5 {x} myths, debunked.","The {x} myth that costs you.","Stop believing this about {x}."],
 "announcement": ["New {x} just dropped.","We finally made {x}.","{X}, but better."],
 "testimonial": ["10,000 people switched {x}.","'I didn't believe {x} would work.'","Reviews made us cry: {x}."]
}
```

### Prototype mechanics worth keeping
- **Mock beat generator:** video duration = 22 + (days mod 9) seconds; beats = hook 0–2.5s, problem 2.5–7s, demo 7–14s, proof 14–(d−4)s, cta (d−4)–d s. Image ads have no timeline (single-frame layout: headline, product, offer).
- **Default beat visuals:** problem "close-up, relatable frustration"; demo "product in real use, handheld"; proof "result shown on screen, number overlay"; cta "product hero + offer card".
- **Voice rule:** pattern containing `founder` → "on-camera talking head", else "creator VO".
- **Role colors (UI):** hook `#ff8a5b`, problem `#ffc95b`, proof `#7c9cff`, demo `#4fd1a5`, cta `#c58bff`.
- **Prototype theme tokens:** bg `#0b0d10`, panel `#14171c`, line `#252a32`, text `#e8eaed`, muted `#8b929c`, accent `#7c9cff`, hot `#ff8a5b`, ok `#4fd1a5`, bad `#ff6b6b`; fonts Inter + JetBrains Mono.
- **Hook step:** Claude returns 10, page keeps top 5 by weighted score. **Adapt step:** brief text after "Offer:" becomes the CTA line in the template fallback.
- **Per-shot re-render button** with cost increment (+$0.12 mock) — kept as a UI idea for the Phase 2 demo.

---

## 2. Additional examples

### Sample brief used in the prototype
`Our app plans a week of meals in 2 minutes. Offer: 14-day free trial.` (topic: `meal prep`)

### Reference posts that inspired the project
- **Viral-reel cloner skill** (LinkedIn): paste a reel link + one-line idea → shot-by-shot breakdown (hook, pacing, captions, sound) → idea written into the same structure → Scenario generates assets → Claude edits in code. Example: "highest paid jobs in America" ranking reel → "animals that sleep the most" ranking reel; original hook "The highest paid job in America isn't CEO." → new hook "The animal that sleeps the most isn't the sloth." (Source of the `contrarian_reveal` pattern.)
- **Meta ad spy in Claude** (LinkedIn, AdScan): brand board for Huel showing 1,330 active ads (726 video, 604 image, 4 carousel, 117 creator), cards ranked by days running (286 / 253 / 234 / 175), "12 long-running winners to study first." Spend estimated at $13 CPM. (Source of the days-running signal.)

---

## 3. Meta official API setup (detail beyond handoff)

For the optional `meta` adapter.

1. facebook.com/ID: upload ID, confirm country, SMS. 1–3 business days. Queries return "Identity verification required" until approved.
2. developers.facebook.com → Get Started.
3. My Apps → Create App → use case Other, type Business, name `autoclone-dev`.
4. facebook.com/ads/library/api → Access the API → accept "Authorized Access to Public Information" terms (read them: commercial-use rules live here).
5. Graph API Explorer → User Token → `ads_read` → Generate (1 hour). Exchange for 60-day token:
```bash
curl -G "https://graph.facebook.com/v24.0/oauth/access_token" \
  --data-urlencode "grant_type=fb_exchange_token" \
  --data-urlencode "client_id=YOUR_APP_ID" \
  --data-urlencode "client_secret=YOUR_APP_SECRET" \
  --data-urlencode "fb_exchange_token=SHORT_LIVED_TOKEN"
```
6. Test (Ireland first = English-language EU ads, closest to US creatives):
```bash
curl -G "https://graph.facebook.com/v24.0/ads_archive" \
  --data-urlencode "search_terms=huel" \
  --data-urlencode "ad_reached_countries=['IE','DE','FR','NL']" \
  --data-urlencode "ad_active_status=ACTIVE" \
  --data-urlencode "ad_type=ALL" \
  --data-urlencode "fields=id,page_name,page_id,ad_delivery_start_time,ad_snapshot_url,ad_creative_bodies,publisher_platforms,languages" \
  --data-urlencode "limit=50" \
  --data-urlencode "access_token=$META_TOKEN"
```
Errors: 190 = token expired; 613 = rate limit (wait 60s); empty `data` = try `search_page_ids`. Media is not returned directly (only `ad_snapshot_url`). Developers report gaps vs the public website.

## 4. SearchAPI test troubleshooting log
- First run: `export SEARCHAPI_KEY="your_key"` placeholder was used literally → all three files hold errors. **Delete `sa_huel.json`, `sa_gymshark.json`, `sa_ag1.json`** before re-testing.
- Second run: real key returned `{"error": "Invalid API key."}`; key length was 23 (expected ~24), likely truncated on copy, or the MCP uses a different provider's key. Check with `claude mcp get searchapi`.
- Third attempt set the key to the literal string `paste_full_key`.
- **Recommended path:** run the test via the `searchapi` MCP inside Claude Code, or use `read -s -p "SearchAPI key: " SEARCHAPI_KEY; export SEARCHAPI_KEY` so the key is never typed into a command.
- The key appeared in a screenshot → **regenerate it**.
- Keyword `q=` search may return resellers/affiliates; switch to `page_id` once the brand's page is identified.

---

## 5. Pending decisions

| Item | Notes |
|---|---|
| Product name | AutoClone is the working name. Alternatives floated: **FormatLift**, **Remix**. |
| Monetization (later) | If ever paid: charge for clone/hook/render, with customers connecting their own data-source key, or license data from a provider. Read Meta's access terms and get a short legal review before charging. |
| Demo brand list | Pick 5–10 global brands with long-running ads for the cached demo (Huel, Gymshark, AG1 tested first). |
| Demo disclosure copy | "Data from the Meta Ad Library" + "not affiliated with these brands"; show your clones beside links to the originals, never re-host brand videos. |
| EU vs US creative match | When using EU-delivered data, prefer English-language EU markets (Ireland) and use the structure, not the offer/pricing. |
| AutoHook | Separate repo (`autohook`, idea 3A in `autoresearch-fork-ideas.md`); build after AutoClone Phase 1. |

## 6. Rejected ideas (with reasons)

| Idea | Why rejected |
|---|---|
| Merge the cloner into AutoHook | Different loops: AutoHook is a cheap text-only optimizer; cloning triggers paid generation. They share `structure.json`, not code. Two repos also make two clearer launch stories. |
| TikTok Creative Center as a source | Scope decision: one ad library, one data contract. Meta only. |
| Official Meta API as the default source | US-only commercial ads aren't returned (EU-delivered only), no spend data, and it needs Facebook ID verification. Kept as an optional adapter. |
| Scraping the public Ad Library site ourselves | Fragile and against Meta's terms. Use a provider (SearchAPI/Apify) instead, where the provider carries the scraping. |
| Paid hosted version on Jerry's personal Meta token | Looks like reselling archive data (reportedly prohibited by Meta's terms); revocation would take the product down overnight. |
| Free-text brand search in the public demo | Would route strangers' queries through Jerry's credentials. Demo uses a cached snapshot instead. |
| Replicate/Seedance/ElevenLabs + Remotion render pipeline | Replaced by Jerry's existing Dreamina + /2minvid workflow, which already works. |
| Ranking by views or estimated spend | Spend can buy views; Meta discloses no spend/reach for commercial ads. Days running + variant count lead the score. |
| Copying footage, exact lines, creator likeness | Only the format carries over; enforced by the originality check. |
