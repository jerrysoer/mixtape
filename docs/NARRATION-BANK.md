# Narration bank — how the voice talks (not what the hook says)

The hook bank (2minvid) stops the scroll. This bank is the other half: the **register** the whole
ad is spoken in, so the narration sounds like one person talking to a friend, never an announcer
reading keywords. Started 2026-11-07 after ep 7 (Walkman) read as "a vlog of a video" (Jerry).

How it is used: `press` writes the narration as ONE monologue in a register from this bank first,
then splits it across the beats at its own pauses. The structure's duration is set to the read, not
the other way round (write long, cut to the read). The register's delivery tag goes in front of the
text for ElevenLabs v4. Each ad records which register it used and Jerry's verdict; the bank grows.

## Rules that hold in every register (from ep 7, 2026-11-07)

1. One speaker, one listener, one situation: who is talking, to whom, about what just happened.
2. Say the thing, not the category of the thing: no "review", "rating", "results", "reviewers agree".
3. Beat 1 continues the hook; the hook's key word or number appears at most once more.
4. Contractions, hesitations ("and it… worked?"), self-corrections, one aside. Sentences of
   different lengths; a question somewhere; never three lines ending on the same word.
5. The last line is something a person says ("Just bring a pencil."), never a slogan or "today".
6. Numbers only if the brief has them (the CLI enforces this); "more than once" is not a number.
7. Target 2.2 words/s for v4 in a casual register (not 2.5): 20 s ≈ 45 words, 25 s ≈ 55. Since sprint 12 the CLI
   audits at this rate (`renders/account.json` → `narrator.words_per_second.eleven_v4`), so the word budgets in the
   press prompt already assume it.

## Registers

| id | who → whom | the move | rhythm | delivery tag (v4) | example | used in | verdict |
|---|---|---|---|---|---|---|---|
| `story_dont_laugh` | you → best friend, right after it happened | opens with "don't laugh", tells it as a scene with one quoted line from someone else, lands on a shrug | short bursts, one long run, a beat of silence before the shrug | `[casual, amused, a little breathless]` | "Okay so, don't laugh. My Walkman ate my tape…" | ep 7 take 1 | **best** (Jerry, 2026-11-07) |
| `read_my_own_review` | you → friend, reading something you wrote | reads the one-line review aloud, then explains it like it's obvious, challenges the listener once | flat, dry, one rhetorical question | `[deadpan, dry, unhurried]` | "So I wrote a review for this thing, and I'll just read it to you…" | ep 7 take 2 | ok, writing still too tidy (Jerry, 2026-11-07) |
| `late_night_confession` | you → friend, lower voice, admitting a thing | "I need to tell you something", the flaw, the loyalty anyway, "I'm not changing my mind" | slower, longer sentences, one list of small flaws | `[quiet, confiding, slightly embarrassed]` | "I need to tell you something about my Walkman…" | ep 7 take 3 | ok, writing still too tidy (Jerry, 2026-11-07) |
| `advice_to_a_buyer` | you → friend who is about to buy one | "if you're getting one, two things", the downside first, the upside as a picture, a last tip | practical, numbered without numbers, one image at the end | `[warm, matter-of-fact, like giving directions]` | "Okay, if you're getting one…" | ep 7 take 4 | ok, writing still too tidy (Jerry, 2026-11-07) |
| `voice_note` | you → friend, a voice memo | starts mid-thought ("yeah so"), trails off, comes back, ends abruptly | run-on, one "anyway", no proper ending | `[relaxed, recorded on a phone, slightly distracted]` | — | — | — |
| `overheard_argument` | you → someone off-mic who disagrees | answers an objection we never hear ("no, listen…"), wins, grins | two-beat volleys, rising then settling | `[insistent, playful, half-laughing]` | — | — | — |
| `tour_guide_of_my_own_life` | you → a friend you are showing round | "this is where…", "and that's the…", present tense, pointing at things | even, warm, each sentence points at one object | `[warm, unhurried, showing you around]` | — | — | — |
| `apology_to_the_product` | you → the object itself | talks to the thing like a pet; forgives it | soft, mock-serious | `[tender, mock-serious]` | — | — | — |

Add a row when a new voice works; fill `used in` and `verdict` after Jerry listens. A register with
two "no" verdicts gets a note, not a deletion (we need to remember why).

## Imperfection layer (`src/render/imperfect.ts`)

Even the winning register read too clean: "needs to sound like someone talking, a normal TikTok video,
not advertising; 10 to 20% imperfection, randomized" (Jerry, 2026-11-07). The layer drops natural
disfluencies into the finished monologue, seeded so a take is reproducible:

- unit = clause (sentence and comma boundaries); `rate` × clauses are touched, 10–20% (hard cap 30%)
- never the first clause (the hook) or the last (the landing); never two clauses in a row; one laugh max
- kinds: `restart` ("My— my Walkman"), `filler` (like / I mean / um / honestly, never a word the text
  already uses), `trail` ("goes… 'use a pencil'"), `hedge` (", kind of"), `laugh` (`[laughs]`), `breath` (`[exhales]`)
- the tags are v4 delivery tags; captions strip them (`charsToWords`)
- the writer still owns the semantic imperfections (a self-correction, an aside); the layer is mechanical

Ep 7 takes for listening (2026-11-07): `1-imperfect-10` (23.6 s), `-15` (24.6 s), `-20` (25.7 s) on take 1's
text; `1b-looser-15` (29.3 s) on a looser rewrite (present tense, fragments: "Just, pencil."). Verdict: **15% picked** (Jerry, 2026-11-07); delivered as `cb-ep07-walkman-d` (31.0 s). Note: recorded line by line the same text ran 31 s vs 24.6 s as one take, and three clips had to be re-bought (414 cr). Sprint 12 (2026-11-07) made one-take recording the only ElevenLabs path: the whole ad is sent as one request with the account's `delivery_tag` ("[casual, amused, a little breathless]") and `voice_settings` (stability 0.35, similarity 0.8), the character timestamps are split back into shots, and each shot's line is cut out for the lip refs. The voice is now recorded BEFORE the stills quote, so the read length is known before any Dreamina credit.

## Pairing with formats

F3 review read-aloud → `read_my_own_review`, `story_dont_laugh`. F1 founder → `late_night_confession`,
`overheard_argument`. F2 POV → `voice_note`. F13 unbox → `tour_guide_of_my_own_life`. F11 street
interview → the interviewee's answer is its own register (to write). Unassigned formats pick by tone
column in the content plan.

## In the CLI (sprint 13, 2026-11-08)

- `press --register <id>` reads this table (`src/render/register.ts` parses the "## Registers" rows: the id, who → whom,
  the move, rhythm, tag and example columns; keep that column order). The prompt quotes the row and asks for one
  `monologue` first, then the split; `--finish` refuses a split that does not add back up to the monologue word for
  word. The script records `audio.register` and `audio.delivery_tag`; render puts that tag in front of the take
  instead of the account's.
- After the voice stage the read is the ad's length: the plan's `duration_s` and every shot's window follow the
  recorded words (`plan.read_s`; the structure's target stays in `target_s` for the comparison).

## Next (CLI)

- `renders/validation.csv` gains a `register` column so performance can be read by register later.
- A `tone` column in the content plan mapping to a register for `batch`.
