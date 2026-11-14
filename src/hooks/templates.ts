import type { HookPattern } from "../schema/structure.js";

/**
 * Offline fallback hooks (used with --offline, when Claude isn't in the loop).
 * The first three per pattern come from docs/AutoClone-Extras.md §1; the last two
 * (and all of before_after) were added in sprint 2 so every pattern yields 5.
 * `{x}` = topic lowercase, `{X}` = topic capitalized.
 */
export const HOOK_TEMPLATES: Record<HookPattern, readonly string[]> = {
  contrarian_reveal: ["The best {x} isn't the one you think.", "Everyone's wrong about {x}.", "{X} experts won't tell you this.", "I was wrong about {x} for years.", "Nobody talks about this side of {x}."],
  stop_doing_x: ["Stop doing {x} like this.", "You've been doing {x} wrong.", "Quit {x} until you see this.", "Please stop buying {x} the old way.", "If you still do {x} like this, stop."],
  pov: ["POV: you want {x} but you're lazy.", "POV: you finally fixed {x}.", "POV: {x} at 7am.", "POV: your friends just found out about {x}.", "POV: you tried {x} once and never went back."],
  day_in_life: ["My {x} routine that actually stuck.", "What {x} looks like on a busy day.", "I tried {x} every day for a week.", "A normal Tuesday, but with {x}.", "Here's where {x} fits in my morning."],
  number_shock: ["{X} for less than a coffee.", "This saved me 4 hours of {x}.", "90% of people get {x} wrong.", "I spent $300 on {x}. Worth it?", "{X}: 3 seconds, zero effort."],
  sensory: ["Just listen to this {x}.", "The most satisfying {x} ever.", "Turn sound on for {x}.", "Close your eyes and hear {x}.", "Wait for the sound at the end. {X}."],
  myth_bust: ["5 {x} myths, debunked.", "The {x} myth that costs you.", "Stop believing this about {x}.", "{X} isn't what you were told.", "The biggest lie about {x}."],
  announcement: ["New {x} just dropped.", "We finally made {x}.", "{X}, but better.", "It's here: {x}.", "You asked for {x}. We built it."],
  testimonial: ["10,000 people switched {x}.", "'I didn't believe {x} would work.'", "Reviews made us cry: {x}.", "A customer just told us this about {x}.", "Five stars, one complaint: {x}."],
  before_after: ["Before and after {x}. Wait for it.", "Day 1 vs day 30 of {x}.", "Same person, before and after {x}.", "What {x} did in one week.", "Left: no {x}. Right: {x}."],
};

export function fillTemplate(template: string, topic: string): string {
  const t = topic.trim().replace(/\s+/g, " ");
  const lower = t.toLowerCase();
  const upper = lower.charAt(0).toUpperCase() + lower.slice(1);
  return template.replaceAll("{x}", lower).replaceAll("{X}", upper);
}

/** Five filled template hooks for a pattern, in template order (unscored). */
export function templateHooks(pattern: HookPattern, topic: string): string[] {
  return HOOK_TEMPLATES[pattern].map((t) => fillTemplate(t, topic));
}
