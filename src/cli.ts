import { Command } from "commander";
import { batchCommand, type BatchOptions } from "./commands/batch.js";
import { breakCommand, type BreakOptions } from "./commands/break.js";
import { doctor } from "./commands/doctor.js";
import { hookCommand, type HookOptions } from "./commands/hook.js";
import { pressCommand, type PressOptions } from "./commands/press.js";
import { renderCommand, type RenderOptions } from "./commands/render.js";
import { spyCommand } from "./commands/spy.js";
import { VERSION } from "./version.js";

export function buildProgram(): Command {
  const program = new Command()
    .name("mixtape")
    .description("Clone a proven ad format into a new, original 9:16 ad.")
    .version(VERSION)
    .showHelpAfterError();

  program
    .command("doctor")
    .description("Check the tools and keys Mixtape needs (never prints key values)")
    .action(async () => {
      process.exitCode = await doctor();
    });

  program
    .command("break")
    .description("Break a source ad into structure.json (prep writes a prompt; --finish validates the answer)")
    .argument("[source]", "video file, https link, or saved Meta ad .json")
    .option("--ad <id>", "ad_archive_id to pick from a saved page of ads")
    .option("--describe <text>", "no video: describe the format in words")
    .option("--transcript <file>", "use this transcript instead of running whisper")
    .option("--duration <seconds>", "length of a described format (default 20)")
    .option("--finish <job-id>", "validate the answer for a prep job and save structure.json")
    .option("--answer <file>", "answer file for --finish (default .cache/break/<job>/answer.json)")
    .option("--out <file>", "where --finish saves structure.json (default data/structures/<job>.structure.json)")
    .action(async (source: string | undefined, opts: BreakOptions) => {
      process.exitCode = await breakCommand(source, opts);
    });

  program
    .command("hook")
    .description("Write 10 hooks in the structure's pattern, score them, keep the top 5 (prep, then --finish)")
    .argument("[structure]", "a .structure.json file or a built-in format id (F1-F14)")
    .option("--topic <text>", "what the new ad is about, e.g. \"dial-up internet, 1999\"")
    .option("--offline", "skip Claude: fill 5 template hooks for the pattern")
    .option("--finish <job-id>", "validate the scored hooks and save structure.json with the top 5")
    .option("--answer <file>", "answer file for --finish (default .cache/hook/<job>/answer.json)")
    .option("--out <file>", "where to save structure.json (default data/structures/<job>.structure.json)")
    .action(async (structure: string | undefined, opts: HookOptions) => {
      process.exitCode = await hookCommand(structure, opts);
    });

  program
    .command("press")
    .description("Press a new script.json from a structure and your brief, originality-checked (prep, then --finish); with no hooks on the structure the hook is written in the same step")
    .argument("[structure]", "a .structure.json file (with or without hooks) or a format id (F1-F14)")
    .argument("[brief]", "the product, the facts you can claim, the offer")
    .option("--brief-file <file>", "read the brief from a file")
    .option("--hook <n>", "which hook candidate to use, 1-5 (default 1 when the structure has hooks)")
    .option("--hook-line <text>", "use this hook line instead of a candidate")
    .option("--register <id>", "narration register from docs/NARRATION-BANK.md: one monologue in that voice first, then the split; its tag fronts the take")
    .option("--style <prompt>", "fix the illustration style for every still")
    .option("--style-ref <path>", "reference image for the style")
    .option("--finish <job-id>", "check the answer (originality, timing, claims, shots) and save script.json")
    .option("--answer <file>", "answer file for --finish (default .cache/press/<job>/answer.json)")
    .option("--out <file>", "where to save script.json (default data/scripts/<job>.script.json)")
    .option("--imperfect <rate>", "natural disfluencies over the lines after the audit, 0.1-0.2 sounds like a person (max 0.3)")
    .option("--seed <n>", "seed for --imperfect; same seed = same take (default 1)")
    .action(async (structure: string | undefined, brief: string | undefined, opts: PressOptions) => {
      process.exitCode = await pressCommand(structure, brief, opts);
    });

  program
    .command("render")
    .description("Plan and quote a 9:16 render of script.json (default: stills first, then Seedance clips on the QC-locked stills); re-runs the originality guard; bills nothing without --approve")
    .argument("[script]", "a .script.json from mixtape press")
    .option("--slug <slug>", "folder name under renders/ (default from the file name)")
    .option("--still", "stills + Ken Burns only, no clip stage (narrated with the still-mode voice model)")
    .option("--approve <quote-id>", "approve exactly this quote (it must match the current plan and be within the ceiling)")
    .option("--approve-envelope <grant>", 'grant this render an envelope, e.g. "1000cr $1.50": later --run calls approve each quote by themselves while it fits in what is left')
    .option("--no-dry-run", "skip the free narration dry run with macOS say")
    .option("--run", "the paid run: stills, narration, cut and QC prompt (needs an approval matching the current quote)")
    .option("--qc-finish", "record QC verdicts from renders/<slug>/qc/answer.json and deliver if all pass")
    .option("--fetch", "download paid stills or clips that finished (no spend)")
    .action(async (script: string | undefined, opts: RenderOptions) => {
      process.exitCode = await renderCommand(script, opts);
    });

  program
    .command("batch")
    .description("Turn an episode file into a pack of ads: press each row, one pack quote, render, QC, validation.csv. Never posts.")
    .argument("[target]", "an episode .csv to start a batch, or a batch name for --finish/--approve/--run/--qc-finish")
    .option("--name <name>", "batch name (default from the file name)")
    .option("--rows <list>", "episode numbers, e.g. 1-5 or 1,3,6 (default: the first 5 rows)")
    .option("--finish", "validate answered press prompts; once every row has a script, quote the pack")
    .option("--approve <pack-id>", "approve exactly this pack quote (every row's render quote must still match)")
    .option("--run", "the paid run for every row of an approved pack")
    .option("--qc-finish", "record QC for every row and write renders/validation.csv (motion: a stills pass locks the row; --finish again quotes its clips)")
    .option("--still", "stills + Ken Burns only for every row (no clip stage)")
    .action(async (target: string | undefined, opts: BatchOptions) => {
      process.exitCode = await batchCommand(target, opts);
    });

  program
    .command("spy")
    .description("Add-on: a brand's active Meta ads, ranked by days running and variants (needs your SEARCHAPI_KEY)")
    .argument("<brand>", "brand name; resolved to its verified Meta page")
    .option("--country <cc>", "2-letter market code", "US")
    .option("--max <n>", "stop after this many ads (default 300)")
    .option("--all-media", "include image and carousel ads (default: video only)")
    .option("--page-id <id>", "use this Meta page id instead of looking the brand up")
    .option("--fresh", "ignore cached responses (cache lasts 6 h)")
    .action(async (brand: string, opts: { country?: string; max?: string; allMedia?: boolean; pageId?: string; fresh?: boolean }) => {
      process.exitCode = await spyCommand(brand, opts);
    });

  return program;
}
