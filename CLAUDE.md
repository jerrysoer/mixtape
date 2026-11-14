# CLAUDE.md — Mixtape

Mixtape finds a brand's longest-running Meta ads, breaks a winner into a reusable
format (`structure.json`), writes 5 scored hooks in its pattern, adapts the format to
our own brief (`script.json`), and renders it as a 9:16 ad (voiceover, AI stills → Seedance clips, captions).
Only the format carries over; every line, shot and sound in our version is new.

Pipeline: `spy → pick → break → hook → press → render`. CLI: `mixtape <cmd>` (alias `mx`).
Build order: break → hook → press → render first, spy last (DECISIONS.md: cloning is the showcase).

**Name:** the product was called AutoClone until 2026-11-06. "AutoClone" in `docs/` means Mixtape;
`ac`/`ac_`/`AC_` there mean `mixtape`/`mx_`/`MX_`. Repo `jerrysoer/mixtape`, npm `@jerrysoer/mixtape`.

**Source of truth:** `docs/Mixtape-PRD.md` (v0.2) is the current PRD and supersedes the handoff and v0.1 where they differ.
`docs/AutoClone-Handoff.md` overrides `docs/AutoClone-PRD.md`
wherever they differ (handoff §2, decisions D1–D8). `docs/AutoClone-Extras.md` holds
supporting material (mock fixtures, hook fallbacks, rejected ideas with reasons). Check
`DECISIONS.md` and Extras §6 before re-deciding anything.

**Phase 1 = CLI + Claude Code skill only.** Do not scaffold the Next.js demo (Phase 2).

---

## Skill loading

### Always on (every coding session in this repo)
| Skill | Why |
|---|---|
| `/vibesec` | Every command touches keys, external APIs or untrusted ad text |

Handoff §6 also lists `/frontend-design`, `/web-dev` and `/backend-architect` as
always-on. `/frontend-design` is task-triggered here (Phase 1 has no UI);
`/web-dev` and `/backend-architect` are not installed, so their work maps to the
skills in the table below.

### Task-triggered
| If the task touches... | Load | Handoff name |
|---|---|---|
| Data-source adapters, CLI architecture, Supabase schema | `/supabase`, `/typescript-expert` | /backend-architect |
| ffmpeg / yt-dlp / whisper errors, any failing step | `/debugging` | /debugger |
| Render step (reference only: /2minvid is never edited or called) | read `/2minvid` for patterns | /2minvid |
| Micro-series briefs for `mixtape press` | `/microwriter` | /microwriter |
| Tests | `/testing` | — |
| Demo UI (Phase 2 only) | `/frontend-design`, `/nextjs`, `/visuals` | /frontend-developer, /visual-storyteller |
| End of a phase | `/code-review` | /code-reviewer |
| Launch | `/ship` | /project-shipper |

---

## Conventions

- Node + TypeScript strict CLI (`mixtape`). Python only for `faster-whisper`.
- Media tools: `ffmpeg`, `yt-dlp`, `faster-whisper`, all local.
- Supabase table prefix **`mx_`** on every table and domain column:
  `mx_brands`, `mx_ads`, `mx_structures`, `mx_clones`, `mx_analytics_events`,
  `mx_analytics_daily`. RLS with `auth.uid()` on user-scoped tables. `mx_clones.mx_gen_cost_usd`
  records render spend (PRD v0.2).
- Data source is swappable: `MX_DATA_SOURCE=searchapi | apify | meta` (default `searchapi`).
- Env lives in `.env.local` only: `MX_DATA_SOURCE`, `SEARCHAPI_KEY`, `ANTHROPIC_API_KEY`,
  `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
  `AUTOHOOK_PATH` (optional); Phase 2: `APIFY_TOKEN`, `META_ACCESS_TOKEN`.

## Guardrails

- **Meta only.** No TikTok sources or tools in any phase (D1).
- **Originality guard:** `mixtape render` refuses a script whose lines share any run of more
  than 6 words with the source transcript.
- `structure.json` stores roles and patterns, never original lines, footage, audio or likeness.
- Source media lives only in `./.cache/sources/` (gitignored); never copied into outputs or a demo.
- Never commit keys. Never ask Jerry to paste a key into a command or chat.
- Test and demo fixtures use fictional brands only: source ads from Extras §1 (Fuelwell,
  Northpeak Sleep) and the fictional product Plateful for briefs. Real brand names appear only
  in live data pulls and user uploads.
- Retry with backoff on every data-source call.
- Meta discloses no spend/reach for commercial ads: any spend or reach figure is labeled
  "estimated" or omitted. Days running is the primary winner signal (D8).

## Model routing

Default **Sonnet**. Use **Opus** for: initial scaffold, the `structure.json` schema and
break-down prompt, the data-source adapter interface, the originality guard, RLS policies.

## Phase 1 acceptance (handoff §4, §7)

| Command | Acceptance |
|---|---|
| `mixtape spy <brand>` | ≥100 ads for a global brand in <60 s, sorted by `mx_winner_score`, saved to Supabase + `./data/<brand>.json` |
| `mixtape break <ad_id>` | Schema-valid `structure.json` for 9/10 test ads; roles/patterns only |
| `mixtape hook <structure>` | 10 hooks → scored → top 5 in `hook.candidates`; AutoHook used if `AUTOHOOK_PATH` set |
| `mixtape press <structure> "<brief>"` | Beat timing within ±10%; originality check passes |
| `mixtape render <script>` | 9:16 MP4 with voiceover, word captions and (default) Seedance 2.5 clips on QC-locked stills, or stills with `--still`; two quote gates, every paid call approved first; providers swappable (`MX_IMAGE_SOURCE`, `MX_VIDEO_SOURCE`, default dreamina) |

Phase 1 is done when:
- [x] SearchAPI test run for huel, gymshark, ag1 (2026-11-06; spy is now an add-on)
- [x] `mixtape batch` renders the first 5 rows of the content plan from one approved quote
- [x] `mixtape break → hook → press → render` runs end to end on one uploaded ad in <20 min (2026-11-07: Huel creator ad → Plateful, 12.6 min incl. approval, $1.03)
- [x] `mixtape render` produces the MP4 with no manual edits
- [x] Originality check blocks a deliberately copied script (2026-11-06, `press --finish` on a real Huel structure; render re-runs it in sprint 4)
- [x] This CLAUDE.md, `.claude/settings.json` with disabled MCPs, `.claude/sessions/` gitignored

Winner score: `0.6·norm(days_running) + 0.25·norm(variant_count) + 0.15·norm(est_reach)`;
the reach weight drops to 0 when unavailable and the rest renormalize.

## Verification

Before claiming done: `npm run build`, `npm run lint`, `npx tsc --noEmit`, `npm test`,
and cite the output.
