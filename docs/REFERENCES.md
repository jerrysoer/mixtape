# Open-source references (GitHub search, 2026-11-06)

Stars, licenses and last-push dates come from `gh repo view` on 2026-11-06. Nothing is worth forking whole: build Mixtape's own pipeline and copy specific modules from permissive repos, with attribution.

| Step | Repo | License | Lang | Last push | Use |
|---|---|---|---|---|---|
| spy | [athm793/meta-ads-scraper](https://github.com/athm793/meta-ads-scraper) | Apache-2.0 | TS | 2026-08 | Copy days-running / longest-running-per-angle logic (keep license notice). Scraping may breach Meta terms: never the default provider. Read the code before relying on it. |
| spy | [promisingcoder/MetaAdsCollector](https://github.com/promisingcoder/MetaAdsCollector) | MIT | Py | 2026-10 | Reference only: unofficial GraphQL, CLI + MCP. Will break when Meta changes. |
| spy | [eminberkayd/meta-ads-library](https://github.com/eminberkayd/meta-ads-library) | MIT | TS | 2026-01 | Typed client reference for the official Meta API adapter. |
| break | [XXXJackal/viral-video-analyzer](https://github.com/XXXJackal/viral-video-analyzer) | MIT | Py | 2026-06 | Copy the 12 key-moment taxonomy (hook, curiosity gap, pain point, authority, social proof, before/after, twist, urgency, CTA...) for structure.json roles. |
| break | [udaysrinu/viral-video-analyzer](https://github.com/udaysrinu/viral-video-analyzer) | MIT | Py | 2026-05 | Reference: download → whisper SRT → keyframes → LLM template. Same shape, thinner. |
| hook | [rediumvex/viral-hooks-skill](https://github.com/rediumvex/viral-hooks-skill) | MIT | HTML | 2026-05 | Copy 100 hook formulas as a seed pattern library (check fit for paid ads). |
| render | [gyoridavid/short-video-maker](https://github.com/gyoridavid/short-video-maker) | MIT | TS | 2025-06 (stale) | Architecture reference for TTS → word-timed captions → 9:16 assembly (Remotion; we use ffmpeg). |
| render | [harry0703/MoneyPrinterTurbo](https://github.com/harry0703/MoneyPrinterTurbo) | MIT | Py | 2026-11 | Reference for subtitle timing and fallbacks. |
| render | [vshukla7/remotion-captions-themes](https://github.com/vshukla7/remotion-captions-themes), [Fats403/remotion-captions-kit](https://github.com/Fats403/remotion-captions-kit) | MIT | TS | 2026 | Only if we ever switch to Remotion. |

**Do not copy (license):** Paularossi/AdDownloader (GPL-3.0); pelpeljakob-creator/viral-video-analyzer, mrpaidsocial/Meta-Ads-Spy-Claude-Code-Airtable, ChetanXpro/short-video-automation (no license); shixinzhang/tiktok-viral-hooks (CC BY-NC-SA); harper-carroll/reel-studio-skill (unclear).

**Gaps nobody fills:** no mature "clone a video ad's format" tool exists; no good permissive Node library for word-by-word ffmpeg captions (build ASS/drawtext ourselves).
