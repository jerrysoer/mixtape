# Shot-list contract (`script.json` → shot list for `mixtape render`)

> **Status 2026-11-06:** render is built into Mixtape (DECISIONS.md). /2minvid is not used or changed, so the
> "Gaps: /2minvid needs an `ad` profile" section below is obsolete. The field mapping and shot-slot rules still apply;
> `mixtape export` is now an internal step of `mixtape render`.

`mixtape export <script.json>` writes **one file: `<slug>/vo.json`** in /2minvid's own schema
(prompt schema 2), plus an `mixtape` block. /2minvid then runs its normal steps 3–7:
record → rough cut → quote → stills → build → QC → deliver.

Samples: `fixtures/script.sample.json` (input) → `fixtures/vo.export.sample.json` (output).

## Output folder
```
renders/                       # the Mixtape "account" root for /2minvid (gitignored except account.json)
  account.json                 # STOP 0 once: narrator voice, captions, moves, cr rates, dreamina_project
  <slug>/vo.json               # written by `mixtape export`; the only file Mixtape writes
```

## Mapping script.json → vo.json
| script.json | vo.json | Note |
|---|---|---|
| `hook.line` + `hook_candidates[]` | `hooks[]`, `hook_pick: 0`, `hook_pattern` | top 5 from `mixtape hook` |
| `hook.visual` | shot 1 `prompt` + `hook_device` | device picked from format.md list |
| `beats[i]` | one shot per sentence; `beat` = role upper-cased (PROBLEM, DEMO, PROOF, CTA) | a line over 18 words gets a second shot |
| `beats[i].t` | shot `t_target` | /2minvid times from the recording; `t_target` is checked, not forced |
| `beats[i].visual` | `prompt` + schema-2 slots (`time`, `camera`, `people`, `extras`, `wear`, `state`) | press must emit the slots, not one sentence |
| people in visuals | `characters` (identity only) + `wardrobe` | lint FAILs wardrobe words in a description |
| places in visuals | `sets` ("INTERIOR ONLY:" / "EXTERIOR ONLY:", one space, ceiling + light) | room cards only for sets with 2+ shots |
| `style_lock.style_prompt` | `style` | overrides the account look per ad |
| cta beat | `end_card: true`, `card`, `accent_from_shot` = the CTA shot | the brand colour is the held accent |
| `audio.voice` | `register` / `register_name` | narrator; in motion mode a `shot.speaker` mouths the line (sprint 10 lips) |
| `checks` | `mixtape.checks` | export refuses if `overlap_passed` is false |

## Gaps: /2minvid needs an `ad` profile (cannot render "with no manual edits" today)
/2minvid's lint, batches.py (lint-gated) and deliver.py enforce the 2-minute recap format. An ad fails these:
1. **Shot 1 must be a cover** and shot 4 the spoken title line → ads open on the hook.
2. **Length 330–370 words / 2:00–2:20** → an ad is 20–60 s (target = source duration ±10%).
3. **Beat order** HOOK, TITLE, PROTAGONIST…MEANING, `ending`, `close_q`, one wry aside → ad beats are the structure's roles.
4. **No CTA or end card concept**; deliver.py checks recap tags (`medium`, `angle`, `lead_minor`, `test` arm).

Proposed change to /2minvid (Jerry's skill, needs approval): when `"format": "ad"`,
lint skips the recap checks above and instead checks: hook first word by 0.3 s, predicted
length within ±10% of `duration_target_s`, every `t_target` window within ±15%, a CTA shot
last with `end_card`, `#ad` in hashtags, `aigc_label` true. Everything else (schema-2 slots,
set rules, anatomy QC, quote-and-approve, captions) applies unchanged.

## Other differences to know
- **Talking-head formats** (`founder_talking_head`) render as VO over stills in `--still` mode; in motion mode (default since 2026-11-07) the shot's `speaker` mouths the line in a Seedance clip (DECISIONS 2026-11-07 motion).
- **Claims:** a PROOF line may only use facts in the brief (`checks.claims_in_brief`).
- **Cost per ad:** stills stage ~5–8 stills × 12 cr ≈ 60–100 cr ($0.55–0.90) + ~$0.03 narration; motion stage adds ~5–8 clips × 4–9 s × 18 cr ≈ 400–900 cr ($3.50–8).
