# Mixtape

Clone a proven ad format into a new, original 9:16 ad.

Bring an ad that works (upload it, link it, or describe it). Mixtape breaks it into a format (beats, timing, hook pattern), writes scored hooks in that pattern, presses a new script from your brief, and renders it with a voiceover, AI stills and word-by-word captions. Only the format carries over: every line, shot and sound in your version is new, and an originality check blocks anything that copies the source.

> **Status:** early build (sprint 0 of 8). `mixtape doctor` works; the pipeline commands land sprint by sprint. See [docs/PLAN.md](docs/PLAN.md).

## Pipeline

```
source (upload / link / describe)  →  break  →  hook  →  press  →  render
        └─ optional add-on: spy (rank a brand's long-running Meta ads)
```

| Command | Does | Status |
|---|---|---|
| `mixtape doctor` | Checks ffmpeg, whisper, render tools and which keys are set (never prints them) | ready |
| `mixtape break` | Source ad → `structure.json` (roles, timing, patterns; no original lines) | sprint 1 |
| `mixtape hook` | 10 hooks in the pattern → scored → top 5 | sprint 2 |
| `mixtape press` | Structure + brief → `script.json`, originality-checked | sprint 3 |
| `mixtape render` | Quote first, then a 9:16 MP4 (nothing billed without `--approve`) | sprints 4–5 |
| `mixtape batch` | Episode file → a pack of ads + `validation.csv` | sprint 6 |
| `mixtape spy` | Add-on: a brand's long-running Meta ads, ranked | sprint 7 |

`mx` is a short alias for `mixtape`.

## Quick start (from source)

```bash
git clone https://github.com/jerrysoer/mixtape && cd mixtape
npm install
cp .env.example .env.local   # add the keys you use; .env.local is gitignored
npm run build
node dist/bin.js doctor
```

Needs Node 22+ and ffmpeg. Transcripts use [faster-whisper](https://github.com/SYSTRAN/faster-whisper); images default to Dreamina and voice to ElevenLabs, both swappable.

## Bring your own keys

Mixtape runs on your machine with your own keys. Nothing is hosted, and paid steps (voice, images) always show a quote and stop until you approve it. The spend ceiling defaults to $5 per run (`MX_MAX_SPEND_PER_RUN`).

## Docs

- [PRD](docs/Mixtape-PRD.md) · [Build plan](docs/PLAN.md) · [Validation plan](docs/VALIDATION-PLAN.md) · [Decisions](DECISIONS.md)
- [Open-source references and licenses](docs/REFERENCES.md)

## Develop

```bash
npm run lint && npm run typecheck && npm test && npm run build
```

Test fixtures use fictional brands only.

## License

MIT
