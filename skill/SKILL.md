---
name: mixtape
description: Clone a proven ad FORMAT into a new, original 9:16 motion ad with the Mixtape CLI (break → hook → press → render: stills, then Seedance 2.5 clips lip-synced to ElevenLabs v4 narration), or turn a content plan into a pack of ads (batch). `--still` makes a stills-only cut. Claude Code does the thinking steps (it answers the prompt files the CLI writes); the CLI does media, validation, the originality guard, quotes, the sync gate and the render. Every paid call is quoted and needs the user's explicit approval. Use for: mixtape, clone this ad, break down this ad, ad format, make an ad like this, hooks for this format, press a script, render the ad, motion ad, animate the stills, batch the content plan, validation pack, spy on a brand's ads, longest-running ads.
---

# /mixtape

Mixtape copies the **format** of a winning ad (beats, roles, timing, camera grammar) and nothing else. Every line,
shot and sound in the new ad is new. The CLI is `mixtape` (alias `mx`); in the repo before install use
`node dist/bin.js` after `npm run build`.

Repo: `~/Claude/projects/mixtape`. Run every command from the repo root (it reads `.env.local`, writes `data/`,
`renders/`, `.cache/`).

## Hard rules

1. **Never approve spend yourself.** `render` and `batch` print a quote (credits + dollars + a quote id). Show the
   user the quote and stop. Run `--approve <id>` only after the user says go for **that** quote. A retake is a new
   quote and needs its own go. Approval in one turn never carries to the next quote. A motion render has **three**
   quotes (voice, stills, then clips): each needs its own go. **Envelope:** when the user states a grant in numbers
   for one render ("up to 1000 credits and $1.50 of narration for ep 8"), record it with
   `mixtape render <script> --approve-envelope "1000cr $1.50"`; from then on `--run` approves each quote of that
   render by itself while it fits in what is left (`envelope.json`). Still show every quote, say when one was
   approved from the envelope and what is left, and never invent or round up a grant. A pack (`batch`) has no envelope.
2. **Never read or print secrets.** Don't cat `.env.local` or `.env*`, never ask the user to paste a key. `mixtape doctor`
   shows set/missing safely.
3. **Originality:** never write a line that copies the source ad (the guard blocks any 6+ word run from the
   transcript or ad copy; don't try to slip under it). No real brands, logos, celebrities or existing characters in
   our scripts, stills or clips. Real brand names appear only in source data.
4. **Source media stays in `.cache/`.** Never copy source video, frames or audio into `renders/`, the repo or a review page.
5. **Nothing is posted.** Mixtape never uploads. Posting is the user's job.
6. **Claims:** proof lines use only facts in the user's brief. No invented stats, reviews or prices.
7. **Audio is the master (rule 0).** The ElevenLabs line is never re-timed to a clip; clips are gated and fitted to it.

## The thinking-step pattern (break, hook, press, QC)

Each thinking step is two CLI calls around you:

1. `mixtape <step> … ` (prep) → prints a job id and writes `.cache/<step>/<job>/prompt.md` (plus frames or a contact sheet).
2. Read `prompt.md` **and every image it points to**. Write `.cache/<step>/<job>/answer.json` exactly in the shape the
   prompt specifies.
3. `mixtape <step> --finish <job>` validates and saves. If it rejects the answer, read the reasons, fix the answer,
   run `--finish` again. Don't edit the saved output by hand to get around a check.

## One ad (clone)

| Step | Command | You do | Output |
|---|---|---|---|
| 0 | `mixtape doctor` | check tools; tell the user what is missing | — |
| 1 break | `mixtape break <video \| https link \| ad.json --ad <id>>` or `--describe "<format>" [--transcript f] [--duration s]` | answer the break prompt: roles, beats, timing, patterns, **no source lines** | `data/structures/<job>.structure.json` |
| 1′ | skip break: use a built-in format `F1`–`F14` | — | — |
| 2 hook | `mixtape hook <structure \| F#> --topic "<what our ad is about>"` (`--offline` = templates, no thinking) | write 10 hooks in the pattern, score each, keep the top 5. **Optional for one ad:** skip it and press writes the hook in its own answer (`hook.line`, same pattern and word limit) | structure with `hook.candidates` |
| 3 press | `mixtape press <structure> "<brief>" [--hook n \| --hook-line "…"] [--register <id>] [--style "<prompt>"]` | one line + shot per beat, same roles and times, only brief facts; per shot a `motion` (one camera move + one action) and, for talking formats, a `speaker`. With `--register`, write `monologue` first (the whole ad in that voice), then split it: the pieces must add back up word for word | `data/scripts/<job>.script.json` |
| 4 voice quote | `mixtape render <script>` | show the narration quote (≈ $0.05, chars only); **stop** | `renders/<slug>/QUOTE.md` |
| 4a approve + run | `--approve <voice-quote-id>` after the go, then `--run` | ONE take of the whole ad (`eleven_v4`, the register's tag if the script has one, else the account's, plus the voice settings), split into shots by its timestamps; the CLI prints the read against the target. Over 10%: offer to tighten the script before any still is bought. From here the **read is the ad's length**: every later plan, quote and clip window is cut to it (`QUOTE.md` shows "N s (the recorded read; script target M s)") | `voice/narration.wav`, `voice/words.json` |
| 5 stills quote | `mixtape render <script>` | show the quote; **stop** | `QUOTE.md` (stills section) |
| 5a approve | `mixtape render <script> --approve <quote-id>` | only after the user's go | `approval.json` |
| 6 run | `mixtape render <script> --run` | wait (stills generate in the background, it polls); the cut uses the recorded read | stills cut + `qc/prompt.md` |
| 7 stills QC | answer `renders/<slug>/qc/prompt.md` → `qc/answer.json`, then `--qc-finish` | see QC below | passed shots locked (`qc.json`) |
| 7a retake | fix the failing shot in the script (visual/camera/set), `render` → new quote → go → approve → run → QC | passed shots are locked and reused free | — |
| 8 clip quote | `mixtape render <script>` (once every still is locked) | show the **clip** quote (one Seedance 2.5 clip per shot, 4–30 s each, ~18 cr/s); **stop** | `QUOTE.md` (clips section) |
| 9 approve + run | `--approve <clip-quote-id>` after the go, then `--run` | clips generate from the locked stills; speaking shots lip-sync to their recorded line; the sync gate drops a clip that re-timed the line (its shot keeps the still this run) | motion cut + `qc/prompt.md` (per `clip_NN`) |
| 10 clip QC | answer `qc/prompt.md` → `qc/answer.json` (ids `clip_NN`, verdicts frame/anatomy/motion/lips), then `--qc-finish` | see QC below | **delivered** `renders/<slug>/out/<slug>.mp4` |
| 10a retake | `render` → quote for the failed clips only → go → approve → run → QC | **one** retake per clip; a second fail keeps the still at 0 cr | — |

A clip already on file is reused free when it shows the same thing and is at most 10% shorter than its new window
(the cut slows it to no less than 0.9x and holds the last frame); only a longer gap re-buys it.

`--still` on any `render` call = stills + Ken Burns only (narrated with `eleven_v3`); use it when the user asks for
the cheap cut or the clip stage is blocked.

Brief = the product, the facts we may claim, the offer, the tone. Ask the user for a brief if none was given; for
tests use the fictional product Plateful (meal planner) — never a real brand.

Ask the user only when it changes the ad: which source ad, the brief, the style if `style_lock` is unset, which
hook if the top two are close. Otherwise pick and say what you picked.

Cost to expect: voice ≈ $0.05; stills stage ≈ $0.75–1.00 (7 stills); clip stage ≈ $4–8 (7 clips × 4–9 s × 18 cr).
Live ads so far cost $5.50–9.10 each on Dreamina. Always quote the exact numbers from `QUOTE.md`; never estimate from this line.

## Press: writing for motion

- `motion`: one camera move plus one action that needs nothing new in frame ("slow push in; she lifts the CD to the lens").
- `speaker`: only for talking formats (creator, founder, interviewee, expert), only on shots where that person's face is
  to camera and the line is theirs. One speaker per shot. Hands-only and object shots: no speaker, VO over the action.
- **Voice.** Write the narration as ONE person talking to a friend, in a register from `docs/NARRATION-BANK.md`
  (ep 7 verdict: `story_dont_laugh` best). Pass it as `press --register <id>`: the prompt quotes the register's row,
  asks for the whole ad as one `monologue` first and then the split (the CLI refuses a split that does not add back
  up to the monologue), and the register's delivery tag goes in front of the take instead of the account's
  (`audio.register`, `audio.delivery_tag` in the script). Never restate the hook, no label words
  (review/rating/results), the last line is something a person says. The timing audit runs at the narrator's measured
  pace from `renders/account.json` (`narrator.words_per_second`, 2.2 for `eleven_v4`); the prompt shows the word
  budgets at that pace, and the script records it in `checks.words_per_second`. The narration is recorded as one take
  (the tag and `voice_settings` in front), so the lines must read as one continuous monologue.
- **Imperfection.** The clean lines pass the audit, then `press --imperfect 0.15 --seed <n>` lays natural disfluencies
  over the ad as one monologue (restart, filler, trailing off, hedge, one laugh, a breath; never the hook's first
  clause or the last line; max 30%). Jerry picked 15% on ep 7 (2026-11-07). Recorded in `audio.imperfect`;
  same seed = same take, so a re-cut sounds the same.
- The craft rules the prompt lists (conflict in the first image, readable on mute, write for the ear, lines of 8–15 words,
  no title cards, text off faces, end on the ask) come from Jerry's microwriter, 2minvid and showrun skills; follow them.

## A pack of ads (batch)

1. `mixtape batch <plan.csv> [--rows 1-5] [--still]` → opens one press job per row (rows that name an existing `script`
   skip press). Columns: `ep,title,year,format,product,punchline,hook,tone,script,slug`.
2. Answer every `.cache/press/<job>/prompt.md` (same as press above).
3. `mixtape batch <name> --finish` → validates the answers; once every row has a script it writes one **pack quote**
   (`renders/_batches/<name>/PACK.md`, id `p-…`). Show it; **stop**.
4. After the user's go: `--approve <pack-id>` (refused if any row changed since the quote), then `--run`.
5. QC each `renders/<slug>/qc/prompt.md`, then `--qc-finish`. In motion mode a stills pass marks the row
   **"stills locked"**; run `--finish` again → the pack now quotes those rows' clips → go → approve → run → clip QC →
   `--qc-finish` → delivered rows go into `renders/validation.csv` (post links and metrics stay blank; never estimate a metric).
6. Retakes: edit the failing rows' scripts, `--finish` again → a new pack quote (unchanged rows quote 0) → go → approve → run.

## QC (before anything reaches the user)

**Stills:** open every still at full resolution, one by one. Fail a shot for: wrong or extra fingers, impossible limbs or
poses; readable garbled text that matters to the beat; anything resembling a real brand, logo, celebrity or existing
character (posters too); solid black or empty bands; the shot not showing what its line says; a set that contradicts
the script. Write a short reason per shot. Don't bulk-pass.

**Clips:** look at the cut sheet (first / middle / last frame per clip) AND open every clip mp4 and scrub it. Per clip:
- `frame`: all three frames still show the line's picture; same face, hair, clothes and room as the still it started from.
- `anatomy`: fingers, limbs, faces stay possible in every frame you look at; `n/a` with no person.
- `motion`: the move matches the motion line; nothing morphs or pops in; no cut or camera switch; no brightness jump from the still.
- `lips`: with a speaker, the mouth moves with the words and is closed in silences; with no speaker every mouth stays closed; `n/a` with no face.
Then watch the whole cut: captions in sync, nothing held on a black frame, the voice never fights the picture.
`clips-sync.json` holds each speaking clip's measured ratio (0.85–1.18x passes) and fit; quote it when a lip clip is borderline.

## Fixes that worked

- Seedream ignores "close"; write "extreme close-up … fills the frame, no room visible".
- Close-ups get no set plate, so set clutter (posters) can't leak in: reframe a failing shot as a close-up.
- "Leave empty space" is drawn as a black band; the end card asks for a calm top third instead (built in).
- Long cuts come from numerals and very short sentences in the VO; write numbers as words if timing matters.
- Seedance (from showrun): it re-times any line it is given room to re-time → the audio ref is tight and the gate catches
  the rest; naming an object even to remove it draws it (no negative prompts; describe what IS there); every attached
  person "acts" → only the people in frame are in the prompt; clips come back ~0.3 brighter → the prompt holds the first
  frame's exposure; a third retake rarely fixes the cause → one retake, then the still.

## Spy (add-on, needs the user's own SEARCHAPI_KEY)

`mixtape spy <brand> [--country US] [--max 300] [--all-media] [--page-id id]` → the brand's verified page → active
video ads ranked within the brand (days running 0.6, Meta variant count 0.25; reach unknown) → `data/<brand>.json`.
Then `mixtape break data/<brand>.json --ad <id>`. Meta discloses no spend or reach: never show or guess either.
A 401 means the key is invalid: tell the user to fix it in `.env.local` (and remove a stale shell export).

## Done means

The MP4 is at `renders/<slug>/out/<slug>.mp4`, clip QC passed (or stills QC for `--still`), and you told the user: what
was cloned (format only), the cost actually spent (both stages), the file path, which shots stayed stills and why, and
anything you accepted with a known flaw.
