# Mixtape — Phase 1 build plan

**Date:** 2026-11-06 · **Scope:** CLI + `/mixtape` skill only (no Next.js demo).
**Inputs:** `AutoClone-Handoff.md` (overrides the PRD), SearchAPI test (`data/test/`), /2minvid read-through, `DECISIONS.md`.

Phase 1 delivers one clone end to end: a real long-running ad in, a new 9:16 ad out, with no source
lines, footage, audio or likeness carried over. The cloning chain is built first; `spy` comes last.

---

## 0. Source modes and the test artifact (added 2026-11-06)

- **Core source (free):** `mixtape break <file|url>` or `mixtape break --describe "<format>" [--transcript file]`.
- **Add-on:** `mixtape spy <brand>` (ad library via `MX_DATA_SOURCE`, user's own key). Sprint 6 below.
- **Mac first (2026-11-06):** every sprint is built and tested on Jerry's Mac (ffmpeg, faster-whisper, ElevenLabs,
  Dreamina). The claude.ai test bench (https://claude.ai/artifact/1WQUobPSJCoj6DAKrQSq9X) is an optional prompt
  playground, not a gate. A public artifact or Vercel demo and Supabase come after validation.
- **First real use = validation:** Jerry supplies a content plan; Mixtape turns it into a batch of ads; the ads run
  to see whether anyone cares, before any product polish.

## 0b. Skill mode first (2026-11-06)

The `/mixtape` skill is built first. Claude Code does the thinking (break, hook, press answers); the CLI does
the mechanical work: media download, scene cuts, transcripts, frames, prompt files, schema validation,
originality check, render. Each thinking step is two CLI calls around Claude Code:
`mixtape <step> --prep` writes a prompt (+ frames) to `.cache/`, Claude Code answers, `mixtape <step> --finish <answer.json>`
validates and saves. No `ANTHROPIC_API_KEY`. Standalone mode (CLI calls the Claude API itself) is deferred.

## 1. Build order

Each sprint ends with `npm run build`, `npm run lint`, `npx tsc --noEmit`, `npm test` passing, and a stop for Jerry.

| Sprint | Command(s) | Delivers | Done when | Model |
|---|---|---|---|---|
| 0 | scaffold | repo, TS strict, `mixtape` + `mx` bin, config loader, `.env.local`, Vitest, fixtures (Fuelwell/Northpeak mocks) | `mx --help` lists every command; tests run | Opus |
| 1 | `break` | ad JSON or local MP4 → media in `.cache/sources/` → scene cuts (ffmpeg) → transcript (faster-whisper, cache only) → keyframes → Claude → `structure.json` | schema-valid for the Huel sample + 4 more saved ads; no source line in the output; **format library**: F1–F14 from the Commercial Break plan as `templates/formats/*.structure.json` | Opus (schema + prompt) |
| 2 | `hook` | 10 hooks in the structure's pattern → scored → top 5 into `hook.candidates`; AutoHook if `AUTOHOOK_PATH` | 5 ranked hooks; template fallback works offline | Sonnet |
| 3 | `press` + originality guard | `script.json`: one line + schema-2 shot slots per beat, same roles and times; guard compares to the cached transcript | timing ±10%; a deliberately copied script is blocked; proof lines only use brief facts | Opus (guard) |
| 4 | `render` (plan + quote) | `script.json` → shot list (`vo.json`, see EXPORT-CONTRACT) → voice dry run → image prompts → **quote, stop** | quote shows credits + dollars; nothing billed without `--approve` | Sonnet |
| 5 | `render` (run + build + QC) | voice with word timestamps → stills → ffmpeg assembly (moves, word captions, end card, -14 LUFS) → frame + anatomy QC → `renders/<slug>/out/<slug>.mp4` | MP4 from the Plateful fixture with no manual edits; QC verdicts written | Sonnet; anatomy pass Opus |
| 6 | `batch` + validation pack | episode file from `docs/Commercial-Break-Series-Plan.md` (Block A first) → one brief per row → structure × hook × brief → N scripts → one pack quote → renders + captions + a `validation.csv` (ad id, hook, format, brief, post link, metrics left blank) | the plan's first 5 rows render as MP4s from one approved quote; nothing posted automatically | Sonnet |
| 7 | `spy` (add-on) + Supabase | SearchAPI adapter → page lookup → paginate → days running, `collation_count`, `mx_winner_score` → `data/<brand>.json` + `mx_ads` | ≥100 Huel ads in <60 s, ranked within brand; needs a valid `SEARCHAPI_KEY` | Opus (adapter interface, RLS) |
| 8 | skill + end to end | `/mixtape` SKILL.md (when to call each command, the approve gates) | upload → break → hook → press → render on one real ad in <20 min | Sonnet |
Why this order: cloning is the showcase and the first job is validating ads from Jerry's content plan (DECISIONS.md).
Sprints 1–6 run on Jerry's Mac with uploaded or saved ads; the SearchAPI key is only needed at sprint 7.
After validation: public demo (artifact or Vercel) + Supabase, Phase 2.

---

## 2. Provider interfaces

All external services sit behind small interfaces picked by env var, so open-source users bring their own.

```ts
// src/providers/data/types.ts — MX_DATA_SOURCE=searchapi | apify | meta
export interface DataSource {
  name: 'searchapi' | 'apify' | 'meta';
  findPage(brand: string, country: string): Promise<PageMatch[]>;          // verified pages first
  listAds(q: AdQuery): AsyncIterable<AdPage>;                              // handles next_page_token
}
export interface AdQuery { pageId: string; country: string; active: boolean; media: 'video' | 'all'; maxAds?: number }
export interface AdPage { ads: Ad[]; total?: number; nextToken?: string }
export interface Ad {                       // normalized; every adapter maps into this
  id: string; pageId: string; pageName: string;
  startDate: string; endDate?: string; isActive: boolean;
  format: 'video' | 'image' | 'carousel' | 'dco';
  videoUrls: string[];                       // snapshot.videos[] AND snapshot.cards[].video_*_url
  bodyText?: string; ctaType?: string; linkUrl?: string;
  variantCount: number;                      // SearchAPI: collation_count
  estReach: null;                            // Meta gives none for commercial ads
  raw: unknown;                              // original object, for debugging
}

// src/providers/image/types.ts — MX_IMAGE_SOURCE=dreamina (Phase 1) | others later
export interface ImageProvider {
  quote(jobs: ImageJob[]): Promise<Quote>;               // never bills
  run(jobs: ImageJob[], approval: ApprovalToken): Promise<ImageResult[]>;
}

// src/providers/voice/types.ts — MX_VOICE_SOURCE=elevenlabs (Phase 1) | say (free Mac placeholder)
export interface VoiceProvider {
  quote(paragraphs: string[]): Promise<Quote>;
  record(paragraphs: string[], approval: ApprovalToken): Promise<{ wav: string; words: WordTiming[] }>;
}

export interface Quote { units: number; unitName: string; usd: number; lines: string[] }
```

Rules every adapter follows: retry with backoff, cache responses under `.cache/`, never log keys,
`ApprovalToken` comes only from an explicit `--approve <quote-id>` so nothing paid runs by accident.

---

## 3. File layout

```
mixtape/
  CLAUDE.md  DECISIONS.md  HANDOFF.md  package.json  tsconfig.json  .env.local (gitignored)
  bin/mixtape.ts                     # entry; also installed as `mx`
  src/
    commands/  spy.ts break.ts hook.ts press.ts render.ts
    providers/ data/{types,searchapi,apify,meta}.ts  image/{types,dreamina}.ts  voice/{types,elevenlabs,say}.ts
    media/     download.ts scenes.ts transcribe.ts keyframes.ts assemble.ts captions.ts loudness.ts
    claude/    client.ts prompts/{break,hook,press}.ts
    guard/     originality.ts timing.ts claims.ts
    score/     winner.ts             # 0.6·days + 0.25·variants (+ reach when known), ranked within brand
    schema/    structure.ts script.ts shotlist.ts   # zod schemas = the contracts
    qc/        frames.ts anatomy.ts
    db/        supabase.ts           # optional: no env → files only
  python/      transcribe.py         # faster-whisper only
  skill/       SKILL.md              # /mixtape
  supabase/migrations/               # mx_ tables, sprint 6
  fixtures/                          # mock brands, sample script + shot list
  tests/
  data/        test/ <brand>.json structures/ scripts/      # gitignored (real brand data, signed URLs)
  renders/     account.json <slug>/                         # gitignored except account.json
  .cache/      sources/ transcripts/ api/                   # gitignored; source media never leaves here
```

---

## 4. Where the test results contradict the handoff

| Handoff says | Test showed | Change |
|---|---|---|
| ~25 ads per call | 30 per call | page size 30 |
| Video URL in `snapshot.videos` | 0–83% there; DCO ads keep it in `snapshot.cards[]` | read both (in `Ad.videoUrls`) |
| `yt-dlp` fallback if no URL | every ad had a direct MP4 URL; links expire | drop yt-dlp from Phase 1; download at `break` time |
| Search by brand name (`q`) | keyword search mixes in other advertisers; "ag1" doesn't find AG1 | resolve to a verified `page_id` first, then search by page |
| Days running = proven winner | true for Huel (10 ads ≥175 d); Gymshark oldest 37 d, AG1 107 d in the top 30 | rank within brand, not by fixed day thresholds |
| Sort ads by score | API sorts by impressions only | paginate fully, sort locally |
| Variant count by clustering text + duration + frame hash | Meta returns `collation_count` | use it; clustering only as a fallback |
| `est_reach` weight 0.15 | `impressions_index` is -1 | weight 0 (already allowed by the renormalize rule) |
| MCP for the test, key for the CLI | MCP works by browser sign-in; the shell key is invalid | key needed only at sprint 6 |
| D6: end at a file for /2minvid | /2minvid enforces the recap format | `mixtape render` built in (DECISIONS.md) |

---

## 5. Answers (Jerry, 2026-11-06)

1. **Supabase:** files only until sprint 7; `spy` adds the `mx_` migration then. **Decided.**
2. **Voice:** open; decide before sprint 5 (render run). Sprint 4 uses the free Mac voice for dry runs.
3. **Look:** open; Jerry will give the default clone style before sprint 5. Until then `style_lock` must be set per script.
4. **Approval:** one quote per clone covering voice + stills, ceiling `MX_MAX_SPEND_PER_RUN` (default $5). **Decided.**
5. **Outside-activity approval:** out of scope for this plan.
6. **Content plan:** supplied: `docs/Commercial-Break-Series-Plan.md`. Test and validation plan: `docs/VALIDATION-PLAN.md`.
7. **Validation channel and metric:** TikTok + Instagram Reels, organic; hypotheses H1–H8 and gates G1–G4 in `docs/VALIDATION-PLAN.md`.
