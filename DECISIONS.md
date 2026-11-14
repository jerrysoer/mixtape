# DECISIONS — Mixtape

## 2026-11-06 — Cloning first, spy last
- **Decision:** The product's showcase is the clone (break → hook → press → export), not winner-finding. Build order puts `spy` last; Phase 1 starts from ads already pulled into `data/test/`.
- **Why:** Step 2 SearchAPI test showed days running is a strong signal for Huel (10 active video ads ≥175 d) but weak for Gymshark (oldest 37 d in top 30) and AG1 (oldest 107 d). Jerry: "I really want to show off the cloning abilities, not finding the best ads ever."
- **Consequence:** The CLI SearchAPI key (`.env.local`) is only needed when `spy` is built. The browser-auth MCP covers interactive pulls until then. Winner score stays simple (days running + Meta's `collation_count`, ranked within the brand).

## 2026-11-06 — SearchAPI response facts (from step 2 test)
- Video URLs live in `snapshot.videos[]` (VIDEO format) **or** `snapshot.cards[].video_hd_url` (DCO format). Read both.
- URLs download directly (signed, expire) → fetch media at `break` time; no yt-dlp fallback needed.
- Default sort is impressions; no sort by age. Search by verified `page_id`, never keyword (resellers, wrong advertisers).
- `collation_count` = Meta's own variant grouping; use it instead of custom clustering.
- `impressions_index` = -1 → no reach data; reach weight = 0.
- MCP inline responses cap at ~80 KB; the `full_result_url` it returns is fetchable without auth.

## 2026-11-06 — Render lives inside Mixtape, not /2minvid
- **Decision:** /2minvid stays untouched. Mixtape gets its own render step (`mixtape render`), built from the same kinds of parts (narration with word timestamps, Dreamina stills with quote-and-approve, ffmpeg assembly with word captions, QC) but purpose-built for 20-60 s ads. One skill, `/mixtape`, covers spy → break → hook → press → render.
- **Why:** /2minvid's lint, batches and deliver enforce the 2-minute recap format (cover, title line, 330-370 words, recap beats); an ad mode would bend a working skill. Also, Mixtape is open source: users won't have Jerry's private /2minvid, so the render must ship in the repo.
- **Replaces:** handoff D6 ("Mixtape's job ends at a render-ready script.json"). `mixtape export` becomes an internal step of `mixtape render`, not a handoff.
- **Rejected:** adding `format: ad` to /2minvid; a separate `/adclone` skill (two names for one pipeline; renamed together if the product name changes, see Extras §5).

## 2026-11-06 — Renamed AutoClone → Mixtape
- **Decision:** product, skill, repo and CLI are **Mixtape** (`/mixtape`, `jerrysoer/mixtape`, `mixtape` + alias `mx`). Table/column prefix `mx_`, env prefix `MX_`. npm publishes as `@jerrysoer/mixtape` (bare `mixtape` is held by npm as a deprecated name).
- **Why:** Jerry's pick. Renamed before any repo, tables or code existed, so nothing to migrate.
- **Kept:** `docs/AutoClone-*.md` keep their names and text (source documents); CLAUDE.md maps the old terms.

## 2026-11-06 — Plan answers
- Supabase: files only until sprint 6 (`spy`), then the `mx_` migration.
- Spend: one quote per clone (voice + stills), ceiling `MX_MAX_SPEND_PER_RUN` default $5, `--approve <quote-id>` required.
- Open until before sprint 5: narrator voice, default clone look. TikTok approval: not tracked here.

## 2026-11-06 — Bring-your-own source is core; spy is an add-on; test artifact first
- **Decision:** Source is a mode. Core (free): upload a video, link to one, or self-source (describe the format / paste a transcript). Add-on: `spy` over ad libraries with the user's own data-source key (maybe a hosted service later).
- **Decision:** Before any CLI code, a claude.ai test artifact runs source → break → hook → press → download `structure.json` + `script.json`, to prove the prompts and contracts. Render stays in the CLI.
- **Why:** Jerry wants to test the generation side first, with manual input, before Supabase or spy.
- **Limits found:** the artifact extracts frames in the browser (canvas) and sends images to Claude via `sample`; it cannot transcribe audio (transcript pasted or read from on-screen text); links work only from CORS-open hosts (Meta/FB links won't), so upload is the reliable path.

## 2026-11-06 — PRD v0.2 written (docs/Mixtape-PRD.md)
- **Decision:** `docs/Mixtape-PRD.md` v0.2 is the current PRD. It keeps the v0.1 section structure (§1-§9) and adds a "Changes since v0.1" table.
- **Supersedes:** `docs/AutoClone-PRD.md` v0.1 (kept as history, unedited) and `docs/AutoClone-Handoff.md` wherever they differ, including D6 (render now built in), the `ac_`/`AC_` names, the Replicate/Seedance/Remotion stack and the "/context > 150K" criterion. Folds in every DECISIONS entry above and the PLAN §4 test results.
- **Also changed:** `mx_gen_cost_usd` is kept in `mx_clones` (render is in scope), so the CLAUDE.md line that says to omit render-cost fields is stale. `mx_structures` gains `mx_source_kind`.

## 2026-11-06 — Mac first; first use is validation
- **Decision:** build and test every sprint on Jerry's Mac. The claude.ai test bench stays as an optional prompt playground (https://claude.ai/artifact/1WQUobPSJCoj6DAKrQSq9X), not a gate. Public demo (artifact or Vercel) and Supabase come after validation.
- **Decision:** the first real use is a validation run: Jerry's content plan → `mixtape batch` → a pack of ads → run them and see if anyone cares. Batch mode moves from Phase 2 into Phase 1 (sprint 6); spy becomes sprint 7, skill sprint 8.
- **Why:** only the Mac runs the whole pipeline (ffmpeg, faster-whisper, ElevenLabs, Dreamina); the CLI is the product; demand should be tested with real ads before polish.
- **Open:** content plan format (before sprint 6); validation channel, budget and success metric (before the run).

## 2026-11-06 — Validation plan and portfolio goal
- **Decision:** first real use is the Commercial Break series (docs/Commercial-Break-Series-Plan.md), validated on TikTok + Instagram Reels organically per docs/VALIDATION-PLAN.md: hypotheses H1-H8, one factor at a time (format, then decade, then series bits), two posts per cell, medians, gates after posts 6 / 12 / 24.
- **Decision:** add a built-in format library (F1-F14 as structure templates) so episodes need no source ad; spy stays an add-on.
- **Goal:** the project doubles as Jerry's public proof of GTM skill and repo-building skill (VALIDATION-PLAN §6).
- **Conflicts in the series plan, resolved by earlier decisions:** it says render with /2minvid (no: `mixtape render`), step 1 uses spy (templates first), and names `mixtape press` (current name: `press`; rename pending Jerry).

## 2026-11-06 — `adapt` renamed to `press`
- **Decision:** the script step is `mixtape press` (matches the Mixtape theme and the Commercial Break plan). Files: `src/commands/press.ts`, `src/claude/prompts/press.ts`. The prompt text itself ("You adapt proven ad FORMATS…") is unchanged. Older docs (`docs/AutoClone-*`) still say adapt.

## 2026-11-06 — Test bench is optional, not a gate
Supersedes: "Bring-your-own source is core; spy is an add-on; test artifact first" (the test-artifact-first part only).
Why: claude.ai artifacts run in a sealed sandbox: no outside network (no ElevenLabs/Dreamina), no safe place for keys, no local tools (ffmpeg, whisper, dreamina-canvas), and media links from other sites are blocked. Only the Mac runs the full pipeline. | Rejected: artifact-first prototype before the CLI | Revisit if: a local MCP server wraps Dreamina/ElevenLabs so a desktop-app artifact can call it (Phase 2 demo).

## 2026-11-06 — MIT license; sprint 0 stack
Why: open source with the fewest barriers for a portfolio repo; copied code must come from MIT/Apache repos (docs/REFERENCES.md). Stack: Node 22+ ESM, TypeScript strict, commander, zod, Vitest, ESLint flat config; config read only from `.env.local`. | Rejected: Apache-2.0 (patent clause not needed), GPL (would scare off users) | Revisit if: a contributor or employer requires otherwise.

## 2026-11-06 — Skill mode first; standalone (API key) mode deferred
Why: Jerry uses Mixtape through Claude Code, which already is Claude, so break/hook/press answers come from Claude Code on his subscription; the CLI does media prep, validation, the originality check and render. No ANTHROPIC_API_KEY needed. | Rejected (for now): CLI calling the Claude API directly | Revisit if: batch runs need to be headless, or before the open-source launch (other users, CI).

## 2026-11-06 — Transcriber: whisper-cpp first, faster-whisper fallback
Why: native `whisper-cli` (Metal) is already on Jerry's Mac and is ~3x faster than faster-whisper on CPU (memory: Rosetta toolchain audit); a 33 s ad preps in 5.6 s. `MX_TRANSCRIBER=auto` picks whisper-cpp (model `~/.local/share/whisper-models/ggml-base.en.bin` or `MX_WHISPER_MODEL`), then faster-whisper via `python/transcribe.py` (`MX_PYTHON`), then none (Claude reads words off the frames). | Rejected: faster-whisper only (the CLAUDE.md "Python only for faster-whisper" convention still holds: Python is only that fallback) | Revisit if: word timings are needed from break (render will need its own aligner anyway).

## 2026-11-06 — structure.json schema (sprint 1)
- Additions to the PRD contract, all optional or additive: hook `visual`; beat `line_role` (what the line does, used by press); source kinds `link` (hostname only, never the signed URL), `template` (F1–F14) and `cache_id` on all non-template sources (points press's originality guard at the cached transcript); hook pattern `before_after` (F4).
- Closed lists: 10 hook patterns, 19 beat roles (adapted from XXXJackal/viral-video-analyzer's key-moment taxonomy + PRD roles + parody `setup`/`punchline`). `format` is any snake_case slug; `KNOWN_FORMATS` is advisory. Objects are strict (unknown keys rejected), text fields length-capped so a transcript cannot be smuggled in.
- Timeline: hook starts at 0, beats tile it with no gaps/overlaps, last beat ends at `duration_s`, tolerance 0.25 s.
- The CLI owns `source`, `duration_s`, `aspect`, `rules`; Claude's answer holds only format, hook, beats, audio.

## 2026-11-06 — break guard: stricter than the script guard
Why: a structure should hold no lines at all, so `break --finish` rejects any text sharing a run of **5+** words with the transcript or ad copy (the press/render guard stays at 7+, "more than 6"), any quoted span of 4+ words, and any mention of the source brand (page name). Nothing is saved on rejection. | Known gaps: on-screen text in music-only ads is not transcribed (no OCR), so copies of it are caught only by the prompt rule; names of real people seen in frames are not checked automatically. | Revisit if: a structure is found carrying on-screen copy (add OCR via the frames).

## 2026-11-06 — hook (sprint 2)
- Same prep/finish shape as break. `mixtape hook <structure|F#> --topic "<topic>"`; `--finish` keeps the top 5 in `hook.candidates`, writes the structure to `data/structures/<job>.structure.json` and all 10 scored hooks to `<job>.hooks.json` (feeds `validation.csv` later). The prompt is the PRD's proven hook prompt plus a one-line guide per pattern and the hook window's spoken word budget (~2.5 words/s).
- Checks: exactly 10, ≤12 words, no duplicates (case/punctuation-folded), integer scores 1-10 with ≥3 distinct values per dimension ("harsh judge" made testable), no 5+ word run from the cached source, no near-copy, no source brand. Ties keep Claude's order.
- `--offline`: 5 templates per pattern (Extras §1's 3 + 2 new; `before_after` all new), no scores.
- **AutoHook contract** (AutoHook isn't built): when `AUTOHOOK_PATH` is set, Mixtape runs `$AUTOHOOK_PATH <structure.json> --topic <topic>` (no shell); AutoHook fills `hook.candidates` in that file and exits 0; Mixtape re-validates and keeps 5. On failure it warns and writes the Claude prompt instead (never a silent fallback). | Revisit when: the autohook repo exists.

## 2026-11-06 — Near-copy check added to the guards
Why: in the sprint 2 live test, "I just came across Tammy's order and had to share" passed the 5-word run check against Huel's "I just came across Sarah's order and I had to share this one": one swapped word breaks every run. `nearCopy()` (src/guard/overlap.ts) flags a line of 6+ words when ≥75% of its words appear in order inside one source window of 2× its length. Applied in break and hook; sprint 3's script guard should use it too, alongside the 7-word run rule. | Rejected: lowering the run threshold (more false positives on common phrases, still beaten by a swap) | Revisit if: real hooks or scripts get false positives.

## 2026-11-06 — script.json layout settled (sprint 3)
- Mirrors the render shot list (vo.json, prompt schema 2) so render is a mapping: top-level `cast` (identity only, UPPER_SNAKE names), `wardrobe` (NAME → key → clothes), `sets` ("INTERIOR ONLY: " / "EXTERIOR ONLY: "); every shot (hook included) has `set`, `time`, `camera`, `people` (NAME → action), `extras`, `wear` (NAME → key), optional `state`. Cross-references are validated (unknown set/cast/wardrobe key, unused cast/set).
- `structure` block (ref, format, source with `cache_id`, duration, aspect) replaces the sample's ad-library `source`, so render can re-run the guard. `hook_candidates` are `{text, score|null}` (scores read from the `.hooks.json` beside the structure).
- The CLI owns times, role order, hook line, music and voice; Claude writes lines, pictures, shots, cast, wardrobe, sets and (unless `--style`) the style prompt. Claude never sees the source transcript in press.
- `fixtures/script.sample.json` (Plateful) rewritten to this layout; it is the sprint 5 render fixture.

## 2026-11-06 — Script guards (sprint 3)
- **Originality:** block any line, picture, cast or set text sharing a run of 7+ words with the cached source (PRD "more than 6"), or a near-copy. `auditScript()` (src/guard/script.ts) runs it with brand, timing and claims; `press --finish` saves only when clean and **render must call it again before any spend** (sprint 4).
- **Timing:** each line ≤ its window +10% at 2.5 words/s; the whole script within ±10% of the structure's duration. Captions-only formats (voice like "no VO") skip the lower bound, and their hook is on-screen text exempt from its window.
- **Spoken hooks:** in voice formats the hook must fit its window (`hookWordLimit`: F-templates' 2 s → 5 words); `hook` enforces it on candidates and `press` refuses a long hook line, naming the candidates that fit. Found when episode 1's 11-word POV hook met a 2 s window. Consequence: earlier hook runs on voice structures may no longer pass (the Huel order-packing hooks of 10 words now fail; 9 max for its 3.4 s window).
- **Claims:** in proof, social_proof, authority, comparison, after, offer, urgency and cta beats, every number (digits or words) must appear in the brief, and strong claim words (clinically, proven, guaranteed, doctor, FDA, cure, #1…) only if the brief uses them. Other non-numeric claims rely on the prompt rule. | Revisit if: a false claim gets through review.

## 2026-11-06 — render plan + quote (sprint 4)
- `mixtape render <script>` first re-runs `auditScript()` against the cached source and refuses (nothing written) on any failure. Then `renders/<slug>/plan.json` (shot list per EXPORT-CONTRACT), `quote.json`, `QUOTE.md` (every prompt, refs, narration, totals).
- Stills follow the /2minvid pattern (read only): a character sheet per cast member, a set plate for each set used by 2+ shots, one still per shot with its sheets + plate attached as refs. Captions-only formats get no narration.
- Quote = **estimate** at `MX_CREDITS_PER_STILL` (12, Seedream 5.0 pro 2K), `MX_CREDITS_PER_USD` (113), `MX_VOICE_USD_PER_1K_CHARS` (0.15; 0 when `MX_VOICE_SOURCE=say`). Sprint 5 must get Dreamina's server quote (`node quote` → `totalMaxCredits`) and refuse to run if it exceeds the approved credits.
- Quote id = sha256 of the exact stills (ids, prompts, refs), narration, aspect and rates. `--approve <id>` must match and be within `MX_MAX_SPEND_PER_RUN`; it writes `approval.json` holding a branded `ApprovalToken` shape (max credits/USD). Re-planning with a different id renames a prior approval to `approval.stale.json`, so a stale approval can never be used. Sprint 5 runs only with `approval.json` whose `quoteId` equals the current quote.
- Voice dry run is a free listen-through only (`say -r 110` → `dryrun/vo.aiff`). Measured: `say -r 150` reads 3.0 words/s, `-r 110` 2.55; its pace isn't linear or the narrator's, so it gives no timing verdict. | Rejected: pass/fail on say's length (it flagged a correctly timed script as 18% short).
- Episode 1 quote: 8 stills, 96 cr, $0.85 (no narration). Plateful on the Huel order-packing format: 7 stills + 443 chars, 84 cr, $0.81.

## 2026-11-06 — Narrator and default look (Jerry: "pick a voice… ElevenLabs v3… follow episode 1")
- Narrator: ElevenLabs `eleven_v3`, voice "PD audition siren" (`eXpIbVcVbLo8ZJQDlDnl`), a young American social-media voice described for commercials; picked by Claude on Jerry's instruction. Default look: episode 1's style, "late-90s home video still, slight VHS grain, warm tungsten lamp light, 9:16". Both in `renders/account.json` (tracked); `press` uses `style_default` when no `--style`.
- Revisit if: the first paid narration (the audition) doesn't land; swap `voice_id` in account.json.

## 2026-11-06 — render run (sprint 5)
- `render --run` runs only with `approval.json` matching the current quote; `spend.json` (Budget) reserves every paid call first and refuses anything past the approved credits/dollars, retakes included.
- Dreamina via `dreamina-canvas`: canvas per slug, all nodes saved first (shots reference sheet/plate nodes as `{{node:…}}` + `--ref node:`), server quote must be ≤ approved credits before anything runs, sheets/plates run then shots, one node per run call, ids persisted before side effects (pattern from showrun's dreamina_batch.py). `canvas create` takes the name positionally; `resource download --output` exists but is hidden from `--help` (found in `dreamina-canvas schema`).
- Narration: one ElevenLabs `with-timestamps` call per line, content-keyed cache, each take checked by whisper (`ggml-small.en`) for repeats/missing words and retaken on a new seed (max 3), lines joined with 0.35 s; `say` is the free placeholder (even word timings). Cuts follow the narration (shot cuts on its line's first word; end card holds 1.2 s); captions-only formats use the structure windows.
- Assembly: Ken Burns push-in/pull-out alternating, 1080×1920 at 30 fps; captions and the end card drawn with ImageMagick (this ffmpeg has no drawtext/subtitles/ass) in DIN Condensed Bold, up to 3 words per chunk; two-pass loudnorm to -14 LUFS (single pass gave -15.2; two-pass -14.5, linear mode respects the -1.5 dBTP ceiling).
- Gotchas fixed with regression tests: ImageMagick `-composite` reads a third image as a mask (merge outline+fill in a group first); a fully transparent canvas saves as 1-bit grey with no alpha and blacked out the picture after the last caption (all caption-track PNGs are `PNG32:`); ImageMagick `@`/`%` in caption text are escaped.
- QC in skill mode: `qc/prompt.md` + a contact sheet of mid-shot frames from the cut; Claude answers frame + anatomy per shot; `--qc-finish` writes `qc.json` and delivers only if all pass. A failed shot needs a new quote.
- Free mode for testing: `MX_IMAGE_SOURCE=placeholder MX_VOICE_SOURCE=say` quotes $0 and runs end to end (Plateful fixture: 23.7 s cut in 15 s).
- Gap: no music provider; captions-only ads (ep 1) get a silent track until a music source is chosen.

## 2026-11-07 — First paid renders: what they taught (sprint 5)
Spent so far: Plateful fixture 84 cr + 305 chars = $0.79 (exactly its quote); ep 1 96 cr = $0.85 (one still failed on Dreamina, error 20008, counted as spent until shown refunded).
- **Shots quote 0 until their reference nodes have run.** A 0 is never cached; nodes are re-quoted just before running, and a node still pricing 0 is refused (Dreamina also refuses a ceiling below its estimate, so this failed safe).
- **Ledger rounding** blocked the 8th of 8 approved stills by $0.00004: the dollar check is now exact (credits/rate + narration stored per entry). One ledger per approval: `spend-<quoteId>.json`.
- **Seedream copies attached images' camera and light**: a close-up given the wide plate came out as the empty room (Plateful shot_04), and ep 1's plate posters (hero lookalikes) spread to 3 shots. Close-ups get no plate; plated prompts say "room only"; every prompt forbids recognisable characters, celebrities and brands.
- **Retakes**: a QC-passed shot is locked, and so are the sheet/plate it was built on; any still with an unchanged prompt is "on file, 0 cr"; a QC-failed or failed still gets a fresh node (the old node is archived in dreamina.json history). Re-quotes charge only what is redone (Plateful retake 12 cr, ep 1 retake 60 cr). Paid-but-not-downloaded stills: `render --fetch` (free), then QC, then re-plan.
- **Waiting** keeps going past a failed node and reports at the end.
- **Loudness**: ffmpeg loudnorm silently goes dynamic when linear gain would pass the true-peak ceiling (v3: -17.3 LUFS in, -0.3 dBTP → -15.2 out). Now exact gain + limiter, re-measured until within 0.3 LU: real v3 narration → -14.3 LUFS, -1.6 dBTP.
- **v3 pace**: about 2.75 words/s vs the 2.5 assumed; the Plateful cut ran 20.0 s for a 24 s target. Revisit if this holds over more runs: set the press budget to 2.75 for v3, or slow the voice.
- Ep 1 script edited after QC (renders/ notes): posters "abstract shapes and landscapes only", CTA camera "close, straight on the modem box", error box "no readable words" (the quoted text box may be why Dreamina failed it).

## 2026-11-06 — Contact sheet for keyframes
Why: Claude Code reading 11-16 separate frames per ad is slow; one tiled 4-across `sheet.jpg` (unlabeled; the ffmpeg build has no drawtext) proved fully legible on the Huel sample, including small captions. The prompt points at the sheet first and lists single frames for detail. | Rejected: labeled tiles (drawtext missing from Homebrew ffmpeg).

## 2026-11-07 — dreamina-canvas download never overwrites
- `resource download --output <existing file>` fails with `cli.invalid_download_output`, so every retake failed at download after the credits were spent. The provider now deletes the old still just before downloading (both fake CLIs refuse to overwrite too, so the retake e2e covers it). Rerunning `--run` after the fix resumed the accepted nodes without billing again.
- Seedream ignores "close" in the camera field: two "close" shots came back as wide rooms. Retake prompts now say "extreme close-up … fills the frame, no room visible".
- **Prompt rule loosened (Jerry, 2026-11-07):** stills may show invented era-style art (made-up bands, original cartoon characters, fake movie art, no readable words). Still banned: real people, celebrities, brands, existing characters. The series docs' "no lookalikes" now means lookalikes of real people or existing IP.
- **"Extreme close-up … fills the frame, no room visible" works:** both retake-2 close-ups came back framed as asked. A frame-filling calendar invites garbled labels (MUN/THLD); next time ask for a blank grid.
- **Sprint 5 accepted 2026-11-07:** Plateful delivered (108 cr / $1.00 total) with shot_04 accepted by Jerry over garbled calendar text; ep 1 delivered (168 cr / $1.49 total, captions only, silent).

## 2026-11-07 — Sprint 6: batch + validation pack
- **Episode file = CSV** (`plans/commercial-break.csv`, tracked): ep, title, year, format, product, punchline, hook, tone; optional brief, script, slug. CSV so it edits in a spreadsheet. The hook line lives in the file (≤5 words for VO formats with a 2 s hook window), so a batch needs no separate `hook` round.
- **Brief built from the row**, punchline verbatim so its numbers pass the claims guard; "generic, no brand" in every brief.
- **One pack quote**: the sum of each row's render quote; pack id = hash of every row's slug + quote id. `--approve <pack>` re-quotes every row first and refuses (writing nothing) if any changed, then writes each row's normal approval. Rows keep their own ledger and ceiling. One row failing in `--run` never stops the others.
- **A row with an existing script skips press** (ep 1 reuses its delivered script; its quote is 0 cr, all on file).
- **validation.csv lives at `renders/validation.csv`** (gitignored, one log across batches). Mixtape owns episode/production columns and refreshes them; post links and metrics are kept as found, never estimated. Per-1k rates derive from the 7-day read. `qc_fails`, `hand_fixes`, `minutes_hands_on` stay blank (not measured). `render_version` = paid rounds (spend ledgers).
- **Content plan edits (no real IP):** ep 2 "crazy frog" → "screaming hamster" (an existing character); ep 5 "Sharpie" → "marker" (a brand).
- Batch paths: rows store script paths relative to the root; render resolves from the cwd, so batch always passes them absolute (caught by the e2e test).
- **Block A pack run (2026-11-07):** 348 cr approved, $3.24 spent. QC: eps 1, 3, 4 delivered; ep 2 shot_03 (smartphone in 2004) and ep 5 shots 2, 3, 5 (poster-covered corporate office; a Superman-like caped poster; a black band in the still) failed. Retake pack `p-6e8b476783`, 60 cr / $0.53.
- **The loosened poster rule fills every room with posters**, including a corporate office, with garbled lettering ("BANLKR") and one Superman-like hero. "May show invented art" reads as an invitation. Sets that shouldn't have posters must say "bare walls, no posters" in the set line.
- **Cuts run long when lines hold numerals or short punchy sentences:** ep 3 ran 24.6 s against 18 s (its 2-word-per-sentence hook took 4.3 s), ep 4 28.7 s against 22 s. The timing guard counts "2002" and "13" as one word each, but they are spoken as 2-3; v3 adds pauses between very short sentences. Next: count numerals as spoken words in the guard.
- **End-card prompt:** "Leave empty space in the top third" was drawn as a solid black band (ep 5 shot_05, twice). Now: "the picture fills the whole frame; keep the top third calm (plain wall, ceiling or sky)". Locked shots keep their stills.

## 2026-11-07 — Poster rule stays loose; long cuts accepted for now
- **Decision (Jerry):** keep the loosened poster rule (invented era art allowed on posters, screens, packaging). Eps 3-4 (24.6 s / 28.7 s vs 18 / 22 s targets) ship long as they are.
- **Consequence:** lookalike posters are handled per set ("bare walls, no posters") or with close-ups when a shot fails QC, not by tightening the global rule. Counting numerals as spoken words in the timing guard is parked, not dropped.

## 2026-11-07 — spy (sprint 7) design
- **Decision:** `mixtape spy <brand>` = page search → pick the blue-verified page whose name (or alias minus usa/us/global/official) matches exactly, preferring the asked country, then most likes → page through `meta_ad_library` by `page_id` (active, video by default) → rank within the brand → `data/<brand>.json`.
- **No verified exact match → refuse** and list candidates; `--page-id` overrides. Keyword search is never used (DECISIONS "SearchAPI response facts").
- **Saved file keeps each raw ad object** plus `mx_rank`, `mx_days_running`, `mx_variant_count`, `mx_winner_score`, so `mixtape break data/<brand>.json --ad <id>` works directly.
- **Default `--max 300`:** the API sorts by impressions only, so a cap biases toward high-impression ads; 300 covers Huel's 335 in ~11 requests. Raise with `--max` up to 2000.
- **Cache:** responses under `.cache/api/searchapi/`, keyed by params without the key, reused for 6 h (signed video URLs expire). `--fresh` bypasses.
- **Key hygiene:** the key is only in the request URL. Network errors keep only the error kind (they can echo the URL); 401/403 fail at once with a fixed message. Tests assert the key never reaches an error, a cache file or a cache name.
- **Supabase optional:** `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` both set → PostgREST upserts into `mx_brands` (on `mx_page_id`) and `mx_ads` (on `mx_ad_id`), no supabase-js dependency. Signed video URLs are not stored (`mx_video_count` only).
- **RLS:** all six `mx_` tables on. Ad-library tables (brands, ads, structures) readable by `authenticated`, written only by the service role (no write policies). `mx_clones`, `mx_analytics_events`, `mx_analytics_daily` owner-only via `(select auth.uid()) = user_id`.
- **Not done:** the migration is written (`supabase/migrations/20261107000000_mx_init.sql`) but not pushed; no Supabase project chosen for Mixtape yet.

## 2026-11-07 — Motion back in: Seedance 2.5 clips are the default render (sprint 9)
- **Decision (Jerry):** `mixtape render` defaults to **motion**: every shot becomes a Seedance 2.5 clip through the Dreamina CLI (`node create video --mode m2v`, 720p 9:16, 4–30 s), started from that shot's QC-locked still. `--still` (or `MX_RENDER_MODE=still`) keeps the stills + Ken Burns cut. Narrator: `eleven_v4` for motion (`narrator.model_motion`), `eleven_v3` for `--still` (`narrator.model`). Default ceiling `MX_MAX_SPEND_PER_RUN` $10.
- **Supersedes** the "Replicate, Seedance and Remotion dropped" lines in `docs/Mixtape-PRD.md` (§ scope, :141, :289, :428) and EXPORT-CONTRACT's "narrator only, no lip-sync" / "VO over stills" — for Seedance only; Replicate and Remotion stay out. Why it was dropped (cost ~6×, consistency) is answered by the two gates below and the one-retake rule.
- **Two gates, one command:** stills quote → approve → run → stills QC (locks) → the same `render` now quotes clips (`q-…` over `[clip id, clip hash]`; stills-stage ids are unchanged, so old approvals stay valid) → approve → run → clip QC (`qc-clips.json`, separate from `qc.json` so a clip verdict never unlocks a still) → delivered.
- **Clip plan** (`src/render/motion.ts`): seconds = `ceil(window − 0.1)` clamped 4–30 from the cut timing (narration words when recorded, else the structure windows); prompt = style + visual + `shot.motion` (or a camera-derived default) + people + "Nobody speaks; every mouth stays closed" or "<speaker> says the line to camera" + hold-the-first-frame line + no-text line. Hash = still hash + prompt + seconds + model + speaker. `MX_VIDEO_MODEL_SILENT` (e.g. seedance_2.0_mini) is an opt-in saver for no-speaker shots; default is 2.5 everywhere (Jerry: top model).
- **Failure policy:** a clip Dreamina fails falls back to its still (delivery never blocks; `stillShots` in render.json). A clip that fails QC gets **one** retake (its own quote; the old verdict is consumed so the retake is judged afresh); a second QC fail keeps the still at 0 cr (`Dreamina.qcRetakes`).
- **Assembly:** clip segments are cover-scaled to 1080×1920, `setsar=1` (Seedance's odd SAR breaks concat; showrun), `tpad` clone if short, cut to the window, clip audio dropped (the ElevenLabs track is the master). Gamma match deferred.
- **Script:** `shot.motion` (≤120 chars) and `shot.speaker` (must be in `people`) are optional; old scripts stay valid.
- **Batch** rows render with `still: true` until sprint 10 adds the pack clip gate.
- **Deferred to sprint 10:** audio ref upload + rule-0 lips line, sync gate (0.85–1.18x), line-lock, press prompt craft rules, SKILL.md rewrite, the `eleven_v4` `/with-timestamps` spike (one paid line, quoted first; whisper word-times fallback if v4 is refused).
- **Rejected:** separate `src/providers/video/` class (the stills `Dreamina` class gained `upload`, `saveClipNode`, clip downloads; same canvas, same state file, less code); straight-to-clips without a stills gate (a bad face costs ~$0.80 instead of ~$0.11); Seedance native dialogue (voice would differ per clip and per ad).

## 2026-11-07 — Lips, sync gate and the batch clip gate (sprint 10)
- **`eleven_v4` works on `/with-timestamps`** (spike 2026-11-07: HTTP 200, 60 aligned characters for a 60-character line, 4.72 s; ≈$0.01). No whisper fallback needed; v4 stays the motion narrator, the existing whisper repeat-check still guards each take.
- **Audio refs (rule 0 step 1):** a speaking shot's clip gets `voice/refs/clip_NN.wav`, cut from the recorded line (`voice/lines/line_NN.wav`): speech starts at 0.1 s, 0.4 s of silence after the last word, nothing else. Built free at plan time (`audioRefs`), spans kept in `voice/refs/spans.json`. The ref's content hash is part of the clip hash, so a re-recorded line re-quotes the clip. The prompt carries showrun's lips line verbatim ("Lips follow {{audio}} exactly…"); the provider swaps `{{audio}}` for the uploaded resource and adds `--ref res:<audio>`.
- **Sync gate (step 4):** after download, the clip's speech span (ffmpeg `silencedetect`, −35 dB / 0.2 s) over the take's: **0.85–1.18x passes**. A fail marks the node `failed (sync: …)`, the shot keeps its still this run, and the next quote retakes it once (a sync fail counts as the clip's one retake, like a QC fail). Verdicts and fits in `renders/<slug>/clips-sync.json`.
- **Line-lock (step 5), one speed + offset:** speed = ratio clamped 0.9–1.1, head trim so the clip's first word lands on the take's first word (`trim`, `setpts` in `clipSegmentArgs`). Phrase-lock (±0.35 s per phrase) is **not** built; revisit if lip clips pass the gate but read as drifting.
- **Why silencedetect, not whisper word times:** rule 0 forbids warping to whisper anchors (0.2–0.7 s off); the envelope span is enough for a ratio and an offset, costs nothing and has no model to load.
- **Press:** SHOT gained `motion` and `speaker`; rule 6 explains when a speaker is set (talking formats, face to camera, the line is theirs; one per shot). A "Craft" section carries the rules distilled from microwriter (marketing-kit, drafting-card), 2minvid ("write for the ear") and showrun (ad-hooks). Not CLI-checked; QC catches them.
- **Batch:** the same `--finish → --approve → --run → --qc-finish` loop runs twice per pack in motion mode: a stills pass marks the row "stills locked", `--finish` re-quotes the pack with those rows at the clip stage. `batch --still` keeps every row at stills (stored in batch.json so later calls agree).
- **Rejected:** Seedance native dialogue (voice drift across clips); a Python port of showrun's `linelock.py` cross-correlation (numpy dependency, and the ad case has one short line per clip, where span ratio + first-word offset is the same fit).

## 2026-11-07 — Narration: register bank + imperfection layer (15%) after the audit
Why: ep 7 narration read as "a vlog of a video"; beat-by-beat writing made slogans. Now press writes ONE monologue in a register (docs/NARRATION-BANK.md; `story_dont_laugh` won) and `press --imperfect 0.15 --seed n` lays seeded disfluencies (restart, filler, trail, hedge, one laugh, breath) over the ad as one monologue AFTER the timing/claims audit, never on the hook's first clause or the last line, cap 30%; recorded in `audio.imperfect`. End card strips delivery tags (`cardText`). | Rejected: imperfections in the prompt (Claude over-does them, not reproducible); applying before the audit (tags/fillers trip the 2.5 w/s check). | Revisit if: v4 stops honouring [laughs]/[exhales], or line-by-line recording keeps running ~25% longer than a single take (then record one take and split by word timestamps).

## 2026-11-07 — Sprint 12: voice first, narrator's real pace, one-take narration, clip reuse tolerance
Why: every live cut ran 10–15% long (targets 20/27/22 s → 22.9/31.0/24.2 s) because the audit assumed 2.5 words/s while the v4 casual read is 2.2; each extra second is 18 cr of clip. Line-by-line recording ran 25% longer than one take (31.0 vs 24.6 s on the same text) and sounded stiffer; a narration change after clips were bought re-bought three clips (414 cr), one of them (6 s on file, 5 s needed) only because legacy nodes had no length recorded. | Decisions: (1) `render` records the narration FIRST as its own ~$0.05 quote (stage `voice`, narration item only, no `say` dry run when ElevenLabs is the source) and prints the read against the target, so the writer can tighten before a still is bought. (2) The timing audit, press word budgets and hook limit run at `renders/account.json` → `narrator.words_per_second[model]` (2.2 for `eleven_v4`), recorded in `checks.words_per_second`; render re-audits at the saved rate. (3) ElevenLabs narration is ONE take of the whole ad (account `delivery_tag` + `voice_settings`: the settings of the ep 7 takes Jerry picked), cache-keyed on the full body, whisper-checked as a whole, split into shots by the character timestamps (`splitWordsByLine`, counts must add up), with `lines/line_NN.wav` cut from the take for the lip refs. (4) A clip on file up to 10% shorter than its new window is reused (`enoughClip`, `CLIP_SHORT_TOLERANCE`), slowed to ≥0.9x and held on its last frame; legacy clip nodes get their length from the file by ffprobe. | Rejected: auto-approving the voice quote because it is small (rule 1 has no size exception; an envelope flag is sprint 13); recording per line with the tag on every line (the pacing is the point of one take); deriving a legacy node's `base` when its hash no longer matches the plan (unknowable, so it stays a re-buy). | Revisit if: v4 one-take alignment ever drops a word (the split throws; fall back to per-line recording), or the 2.2 rate drifts for a new voice (measure and update account.json).

## 2026-11-08 — Sprint 13: spend envelope, hook folded into press, press --register, the read is the length
Why: a motion ad stopped 5–6 times for approvals Jerry had already granted in words ("you have 1000 credits for this"); a single ad took two thinking steps (hook, then press) where one would do; the register bank was a doc the prompt could not see; and after the voice stage the CLI still called the structure's target the ad's length while cutting to the read. | Decisions: (1) `render --approve-envelope "1000cr $1.50"` writes `renders/<slug>/envelope.json` (Dreamina credits + narration dollars, both required, never guessed); `--run` approves the current quote by itself when its credits AND its narration dollars fit in what is left, reserving the full quote, through the same `approveQuote` (ceiling, exact id) and `approval.json` (`envelope: true`) as a hand approval, so ledgers and audit trail are unchanged; a quote that does not fit stops with what is left. Per render folder only, never a batch pack. (2) `press` with no hooks on the structure and no `--hook-line` writes the hook in the same answer (`hook.line`), held at finish to the hook rules (window word limit at the narrator's rate, no source brand, no 5+ word run, no near-copy); `--hook n` still needs `mixtape hook`; a fixed hook may be repeated exactly in the answer, never changed. (3) `press --register <id>` parses the Registers table in `docs/NARRATION-BANK.md` (the markdown stays the source of truth), quotes the row, requires a `monologue` the split adds back up to word for word, and records `audio.register` + `audio.delivery_tag`; render's take tag = script tag, else account tag (a different tag is a different take, so the voice stage runs again). (4) Once `voice/words.json` covers every shot (and the stage is not voice), `plan.duration_s` = the read (`read_s`) and each shot's `t_target` = its read window; `target_s` keeps the structure's figure; QUOTE.md and the run summary say "cut to the read". Quote ids do not hash any of this, so approvals are unaffected. | Rejected: a session-wide envelope in `.env.local` or `account.json` (a grant belongs to one ad, and a file nobody re-reads is how approvals drift); counting an envelope in dollars only (Jerry grants Dreamina credits and ElevenLabs separately); scoring the press-written hook (one hook, no spread to judge; the 10-hook step stays for when hooks are the question); storing registers in JSON (Jerry edits the bank after listening). | Revisit if: an envelope is ever drawn on a quote the user did not expect (then require `--run --envelope` explicitly), or the monologue check blocks legitimate splits (whitespace is already normalised; punctuation is not).
