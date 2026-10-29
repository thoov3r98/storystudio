import type { StoryBible } from "@/lib/schemas/story-bible";
import type { Archetype, HookPick, Plot } from "@/lib/schemas/story-plan";
import { ARCHETYPES, HOOK_STYLES, NARRATIVE_CRITERIA, RETENTION_CRITERIA } from "@/lib/schemas/story-plan";
import { sceneCountRange, targetWordRange } from "@/lib/constants";
import { partBeatRange, plotBeatRange, plotText } from "@/lib/story/plot";
import { GENERIC_HOOK_PHRASES } from "@/lib/story/review";
import { referenceBlock, type ReferenceStory } from "@/lib/story/references";
import { bibleContextBlock, episodeContext, HOUSE_STYLE, type WriterInput } from "./prompts";

/*
 * Prompts for the planned, verified script pipeline (docs/story-quality.md).
 * Creative steps and checking steps are deliberately separate: the writer
 * never grades its own work.
 */

/** Craft principles shared by planning, writing and editing. Guidance, not a formula. */
export const STORY_PRINCIPLES = `What makes a short story work:
- One clear situation and one dramatic question the viewer wants answered.
- Cause and effect. Each major development happens BECAUSE of what came before (therefore) or gets in the way of it (but). Never a string of "and then".
- Earned outcomes. Anything that solves a problem (an object, a skill, a fact, a person) is set up before it is needed. Surprises are welcome; conveniences are not.
- Characters act on what they know and want at that moment, and react like real people would, even when the situation is impossible.
- Fit the length. A short episode has one main conflict and only the developments it needs. Simplify the plot before cutting an explanation the viewer needs.
- Show, don't lecture. No advice to the viewer, no disclaimers, no logistics lists.
- Endings can resolve, fail, escape, discover, sacrifice, turn ironic or open a set-up cliffhanger, whichever this story has earned. Not every story needs a joke, a flaw, a clever victory or three complications.
- Big premise, told simply. An impossible premise is allowed; it just has to keep its own rules.`;

export const ARCHETYPE_GUIDES: Record<Archetype, string> = {
  survival: "Survival / thriller: immediate danger or a hard situation; a clear goal; real constraints (what they have, where they are, the cold, the time); attempts that follow logically and have consequences; an earned resolution or a meaningful failure.",
  mystery:
    "Mystery: an intriguing observation; a clear central question; investigation through clues the viewer also sees; each discovery changes what the hero thinks; a reveal that explains the clues (a bigger mystery may remain).",
  speculative:
    "Apocalypse / speculative: a compelling break from ordinary reality; a few clear world rules that never change without reason; natural human reactions; consequences that come from those rules; stakes and discoveries that escalate. The cause can stay a mystery.",
  comedy:
    "Comedy: a relatable goal or situation; a believable mistake or misunderstanding; each attempt to fix it makes it worse; humour from character and situation, not inserted jokes; a payoff that lands (often reframing what came before).",
  suspense:
    "Suspense / unsettling: an unusual but understandable setup; tension that rises gradually; information revealed in a controlled way; a threat that makes sense; a payoff or a deliberately unresolved, fair central mystery.",
  everyday: "Everyday drama: an ordinary situation with something real at stake; a goal; choices and their consequences; an ending that changes something for the hero.",
};

function archetypeMenu(): string {
  return ARCHETYPES.map((a) => `- ${ARCHETYPE_GUIDES[a]}`).join("\n");
}

export type StorySeed = { archetype?: string | null; dramaticQuestion?: string | null; beatSketch?: string | null };

function seedBlock(seed?: StorySeed | null): string {
  if (!seed || (!seed.archetype && !seed.dramaticQuestion && !seed.beatSketch)) return "";
  return `\nFrom the approved pitch:${seed.archetype ? `\n- Suggested archetype: ${seed.archetype}` : ""}${seed.dramaticQuestion ? `\n- Dramatic question: ${seed.dramaticQuestion}` : ""}${seed.beatSketch ? `\n- Beat sketch: ${seed.beatSketch}` : ""}\n`;
}

/**
 * What one video of a multi-part story must do, and what earlier parts told.
 * Empty for single-episode stories.
 */
export function partBrief(plot: Plot, partNo: number, earlier: string[]): string {
  const parts = plot.parts ?? [];
  if (parts.length <= 1) return "";
  const p = parts.find((x) => x.part === partNo);
  if (!p) return "";
  return `THIS IS PART ${partNo} OF ${parts.length} of one story, each part its own video.
It tells beats ${p.beats.join(", ")} only; later beats belong to later parts and are deliberately not here.
It must satisfy on its own by paying off: ${p.smallPayoff}
${p.cliffhanger ? `It ends on this cliffhanger, the real turn the next part picks up: ${p.cliffhanger}` : "It is the final part: it delivers the story's ending."}
${partNo > 1 ? `Many viewers start here, so the opening orients them in one spoken line (${p.newViewerLine}) without recapping, then hooks.

EARLIER PARTS, AS NARRATED (the viewer of the whole series has heard these):
${earlier.map((t, i) => `Part ${i + 1}: ${t}`).join("\n\n")}` : ""}`;
}

// ── 1. Plot candidates ────────────────────────────────────────────────

export function plotCandidatesPrompt(input: WriterInput & { seed?: StorySeed | null; references: ReferenceStory[]; parts: number }, count = 2) {
  const [minBeats, maxBeats] = plotBeatRange(input.durationSec);
  const [partMin, partMax] = partBeatRange(input.durationSec, input.parts);
  const split =
    input.parts > 1
      ? `- This is ONE story told across ${input.parts} videos of about ${input.durationSec} seconds each, released as Part 1–${input.parts}. Plan ${input.parts * partMin}–${input.parts * partMax} beats in total, ${partMin}–${partMax} per part, so every video has room to breathe: reactions, atmosphere and a pause before each turn.
- parts: split the beats into ${input.parts} consecutive runs. Each part answers one small question of its own (smallPayoff) so it satisfies alone, and every part but the last ends on a cliffhanger that is a real turn in the plot, never an invented one. Parts 2+ get a newViewerLine that orients someone who starts there. The final part delivers the story's ending.
- Escalate across the whole story: the stakes in Part ${input.parts} are bigger than in Part 1.`
      : `- ${minBeats}–${maxBeats} major beats for about ${input.durationSec} seconds of narration. A beat is a change in the situation, not a camera shot.
- parts: one part covering every beat, with an empty cliffhanger and newViewerLine.`;
  const hero = input.narrator?.name ?? "the main character";
  return {
    system: `You are the story architect of a short-form narrated story series. Before any narration is written, you plan the actual chain of events.

${STORY_PRINCIPLES}

Story archetypes (planning tools, not formulas; choose the one that fits, and let it shape the plot without forcing it):
${archetypeMenu()}

How to plan:
${split}
- For every beat: what happens, why it happens now, what the hero wants and knows at that moment, where they are and what they have afterwards, and what changed.
- link: "but" when something gets in the way, "therefore" when it follows as a consequence or decision. Avoid "and then" stories.
- enabledBy lists the earlier beats ("B2"), setups ("S1") and world rules ("R1") that make the beat possible. Every beat after the first has at least one.
- setups: anything a later beat relies on (an object, a skill, a fact, a person). The viewer must learn of it at or before plantedInBeat, which must come before it is used. 0 means it is true from the opening.
- worldRules: the rules of this world, including any impossible premise, stated so they can be checked. They never change without a cause in the plot.
- deliberateMysteries: what is intentionally left unexplained. Leaving the cause of an impossible premise open is fine.
- The resolution says what makes it possible. Never resolve with something introduced only when needed.`,
    user: `${episodeContext(input)}
${seedBlock(input.seed)}
${input.references.length ? `Examples of how other stories in a similar mode are shaped (do not reuse their situations):\n${input.references.map((r) => `- ${r.title}: ${r.structure}`).join("\n")}\n` : ""}
Plan ${count} genuinely different plots for this ${input.parts > 1 ? `${input.parts}-part story` : "episode"} starring ${hero}: different chains of events or endings, not variations of one plan. Keep the premise exactly as given.`,
  };
}

// ── 2. Plot pick (narrative editor) ───────────────────────────────────

export function plotPickPrompt(input: { plots: Plot[]; premise: string; partNumber: number; durationSec: number; parts: number }) {
  return {
    system: `You are a demanding story editor for short narrated videos. Choose the plot a viewer is most likely to follow, care about and find satisfying${
      input.parts > 1 ? ` across ${input.parts} videos of about ${input.durationSec} seconds, each of which must hold a viewer on its own and make them want the next` : ` in about ${input.durationSec} seconds`
    }.

${STORY_PRINCIPLES}

Prefer a clear, coherent plot with an earned ending over a busier or more sensational one. Note real weaknesses honestly.`,
    user: `Premise: ${input.premise}
Part ${input.partNumber}

${input.plots.map((p, i) => `[${i}]\n${plotText(p)}`).join("\n\n")}`,
  };
}

// ── 3. Logic audit ────────────────────────────────────────────────────

const AUDIT_RULES = `You are an independent plot-logic auditor. You did not write this story. Your job is to find real holes a viewer would notice, not to suggest rewrites to taste.

Look for:
1. causal-gap: something happens without a sufficient reason.
2. knowledge: a character knows something they could not know.
3. spatial: a character or object is somewhere it cannot be, or moves impossibly.
4. temporal: events in an impossible order or time frame.
5. rule-violation: a rule of this world changes without justification.
6. motivation: a character acts without a believable reason.
7. convenient-resolution: a solution relies on an ability, object or fact introduced only when needed.
8. character-behavior: a reaction that doesn't fit what the character has just been through.
9. dropped-stakes: an established danger or problem quietly disappears.
10. missing-connection: a moment doesn't follow from the one before it.
11. unpaid-setup: something emphasised as important is never used or answered. This includes the opening: a mystery or promise raised in the first lines must be engaged with by the story (explained, investigated, or deliberately carried forward), not dropped.
12. series-continuity: it contradicts an earlier episode or the story bible.

NOT issues (do not report these):
- The premise itself, however impossible (e.g. "everyone in the world vanished"), and anything listed as a deliberate mystery.
- Information withheld for a later reveal, when the story treats it as a mystery.
- Things a viewer would reasonably infer, and real-world nitpicks that don't affect the story (laws, ages, licences and procedures vary by place; flag them only if the story contradicts itself).
- A reveal that overturns what the hero believed (they thought nobody else remembered, and then someone does) is a twist, not a rule violation, when the story presents it as a discovery.
- Style, word choice or whether you would have told it differently.

Severity:
- blocking: a contradiction or missing link that breaks the story for an attentive viewer. Example: "Kenny types in the bunker code" when nothing showed him learning it; a character in two places at once; the climax happens for no reason.
- significant: a weak link a careful viewer might question, a thin motivation, a threat that fades without explanation.
- minor: a nitpick that doesn't affect understanding.
kind is "contradiction" when it is objectively inconsistent or unexplained, "creative-concern" when it works but is weak. A creative concern is never blocking.

First list intendedUnknowns: what is impossible or unexplained by design. Then report issues, most severe first, at most eight. Every issue must quote exact words from the material as evidence. If the story is sound, return no issues: never invent problems to seem thorough.`;

function previousIssuesBlock(previous?: { id: string; text: string }[]): string {
  if (!previous?.length) return "";
  return `\nEARLIER ISSUES (the writer was asked to fix these; for each id, say in previousIssues whether it is now resolved, and list any that remain in issues again):\n${previous.map((p) => `- ${p.id}: ${p.text}`).join("\n")}\n`;
}

function seriesBlock(series?: { bible: StoryBible; previousSummaries: string[] } | null): string {
  if (!series) return "";
  return `\nSERIES SO FAR (check series-continuity against this)\n${bibleContextBlock(series.bible)}\nEarlier episodes:\n${series.previousSummaries.map((s) => `- ${s}`).join("\n") || "- none"}\n`;
}

export function plotAuditPrompt(input: { plot: Plot; premise: string; previous?: { id: string; text: string }[]; series?: { bible: StoryBible; previousSummaries: string[] } | null }) {
  return {
    system: AUDIT_RULES,
    user: `Audit this PLANNED plot before it is written up. Check every beat: why does this happen now, how does the hero know this, where are they, what are they holding, and is anything established earlier forgotten?
Premise (impossible parts are allowed): ${input.premise}
${seriesBlock(input.series)}${previousIssuesBlock(input.previous)}
PLOT
${plotText(input.plot)}`,
  };
}

export function scriptAuditPrompt(input: {
  /** The plan the narration was told from; null when auditing a script on its own (benchmarks). */
  plot: Plot | null;
  narration: string;
  premise: string;
  previous?: { id: string; text: string }[];
  series?: { bible: StoryBible; previousSummaries: string[] } | null;
  /** For one part of a multi-part story: its scope and the earlier parts. */
  brief?: string;
}) {
  return {
    system: AUDIT_RULES,
    user: `${input.brief ? `${input.brief}\nAudit only this part's narration. Beats from later parts being absent is intended, and so is the cliffhanger; what this part says must still agree with the earlier parts.\n\n` : ""}Audit the NARRATION, which is all the viewer will hear.${
      input.plot
        ? ` The plan is given so you know what was intended, but the viewer never sees it:
- A cause that is in the plan but never reaches the narration is a causal gap.
- Anything the narration adds or changes from the plan (a new object, ability, fact or event) must still make sense on its own.`
        : ""
    }
Quote the narration as evidence.
Premise (impossible parts are allowed): ${input.premise}
${seriesBlock(input.series)}${previousIssuesBlock(input.previous)}${input.plot ? `\nPLAN\n${plotText(input.plot)}\n` : ""}
NARRATION
${input.narration}`,
  };
}

// ── Plot repair ───────────────────────────────────────────────────────

export function plotRepairPrompt(input: { plot: Plot; issues: { id: string; text: string }[]; durationSec: number; parts: number }) {
  const [minBeats, maxBeats] = input.parts > 1 ? partBeatRange(input.durationSec, input.parts).map((n) => n * input.parts) : plotBeatRange(input.durationSec);
  return {
    system: `You repair story plots. For each issue: find the earliest beat where the missing cause, setup or knowledge belongs, fix it there, then update every later beat that depends on it. Keep everything that works exactly as it is. Prefer simplifying (removing a weak beat or convenience) over adding complication. Do not introduce a new object, ability, fact or person unless it is planted as a setup before it is used. Keep ${minBeats}–${maxBeats} beats${input.parts > 1 ? `, split into the same ${input.parts} parts (update parts if beats change)` : ""}.

${STORY_PRINCIPLES}`,
    user: `ISSUES
${input.issues.map((i) => `- ${i.id}: ${i.text}`).join("\n")}

CURRENT PLOT
${JSON.stringify(input.plot)}

Return a diagnosis per issue id, the full repaired plot, and a change log entry per issue id.`,
  };
}

// ── 4–5. Hooks ────────────────────────────────────────────────────────

export function hookCandidatesPrompt(input: { plot: Plot; hero: string; perspective: string; references: ReferenceStory[]; parts: number[] }) {
  const multi = (input.plot.parts ?? []).length > 1;
  return {
    system: `You develop the opening line of a narrated short video: the hook. It decides whether a scrolling viewer stays.

A great hook creates curiosity without confusion. It is concrete and specific, the viewer understands enough to follow and care, and the story that follows fully delivers on what it promises.
- Weak: "Kenny woke up and knew something was terribly wrong." (vague)
- Stronger: "Kenny woke up to forty-seven missed calls. Every single one was from his own phone number." (a specific mystery; only usable if the story explains it or keeps it as a set-up mystery)
Styles to explore: ${HOOK_STYLES.join(", ")}.
Never: ${GENERIC_HOOK_PHRASES.slice(0, 8).map((p) => `"${p}"`).join(", ")}, rhetorical questions, a summary or spoiler of how it ends, or a cliffhanger the plot doesn't pay off.
Don't cram who, where and what into one cumbersome sentence; one or two short spoken sentences.${
      multi ? "\nFor parts 2+, the hook is what a new viewer hears first: it folds in the part's newViewerLine so they know the situation, then pulls them in. Never \"Previously\" or \"In part one\"." : ""
    }
Narration perspective: ${input.perspective}.`,
    user: `PLOT
${plotText(input.plot)}

${input.references.length ? `Openings of reference stories (for craft only, never copy):\n${input.references.map((r) => `- ${r.text.split(/(?<=[.!?])\s/)[0]}`).join("\n")}\n\n` : ""}For ${multi ? `each of these parts: ${input.parts.join(", ")}` : "the episode (part 1)"}, first name its dramatic question and the most interesting concrete moment it contains. Then write 5 opening hooks for ${input.hero} in at least 4 different styles, each with what it promises and which beat delivers it. Return one entry per part.`,
  };
}

export function hookPickPrompt(input: { plot: Plot; parts: { part: number; candidates: { style: string; text: string; promise: string; paidOffIn: string }[] }[] }) {
  return {
    system: `You are a retention editor choosing the opening line of a narrated short video. Judge each candidate against the actual plot:
- clarity: can a viewer understand the situation instantly?
- curiosity: does it open a specific question, tension or emotional pull?
- specificity: concrete details rather than dramatic vagueness?
- deliveredByPlot: does the plot fully pay off what it promises (in that part, or as its cliffhanger)? A sensational opening the plot cannot support is a failed hook. So is one that gives away the ending.
Ratings: weak, acceptable, strong, excellent ("excellent" is rare).
Choose the best one the plot delivers on, then refine it: tighten the words, keep it to one or two spoken sentences, and keep its promise honest. Return one choice per part.`,
    user: `PLOT
${plotText(input.plot)}

${input.parts
  .map((p) => `PART ${p.part} CANDIDATES\n${p.candidates.map((c, i) => `[${i}] (${c.style}) ${c.text}\n    promises: ${c.promise}\n    paid off in: ${c.paidOffIn}`).join("\n")}`)
  .join("\n\n")}`,
  };
}

// ── 6. Narration ──────────────────────────────────────────────────────

export function narrationPrompt(input: WriterInput & { plot: Plot; hook: HookPick; references: ReferenceStory[]; brief: string; beats: number[] }) {
  const [minWords, maxWords] = targetWordRange(input.durationSec, input.wordsPerSecond);
  return {
    system: `${HOUSE_STYLE}

${STORY_PRINCIPLES}

${ARCHETYPE_GUIDES[input.plot.archetype]}

You are the head writer. Tell the approved plot as one continuous story read aloud, ${minWords}–${maxWords} words (about ${input.durationSec}s at ~${input.wordsPerSecond.toFixed(2)} words/second for this narrator).
- Open with the chosen hook, word for word, then flow straight into the story.
- The plot is the source of truth. Every beat ${input.brief ? `of this part (${input.beats.join(", ")})` : ""} appears, in order, with its cause clear to someone who only hears the narration. Plant every setup before it pays off.
- Let it breathe: a reaction, a sensory detail or a beat of silence before each turn. No lists of clothing, equipment or steps.
- Do not invent new rules, objects, abilities, solutions or knowledge. If you must depart from the plot, list it in planChanges.
- Within the first few lines the viewer understands enough to follow and care; they don't need every detail at once.
- Tell it in time order after the opening. Numbers as they are spoken.
- If the words run short of the plot, simplify how things are said, never drop a cause the viewer needs.
- beatCoverage: for each beat number${input.brief ? " in this part" : ""}, the first few words of the narration where it is told.`,
    user: `${episodeContext(input)}
${input.brief ? `\n${input.brief}\n` : ""}
APPROVED PLOT
${plotText(input.plot)}

CHOSEN HOOK (open with exactly this): ${input.hook.hook}
It promises: ${input.hook.promise}

${referenceBlock(input.references)}`,
  };
}

// ── 7. Editorial review ───────────────────────────────────────────────

export function editorialPrompt(input: { narration: string; dramaticQuestion: string; hookPromise: string; partNumber: number; durationSec: number; brief?: string }) {
  return {
    system: `You are an independent editor for narrated short story videos. You did not write this script. Read it as an ordinary adult scrolling past, then judge it with evidence.

Ratings are anchored:
- weak: a viewer would leave or feel cheated. E.g. the first line is vague mood ("Kenny woke up and knew something was terribly wrong"); events are a list of "and then"; the ending summarises ("and that's how she learned...") or resolves by luck.
- acceptable: clear and coherent but predictable; a viewer finishes it without strong feeling.
- strong: every beat changes the situation; at least one development surprises yet is clearly set up; reactions feel human; the ending is earned.
- excellent (rare): all of strong, plus the ending or reveal reframes earlier details (the clues were all there), and nothing could be cut.

Narrative criteria: ${NARRATIVE_CRITERIA.join(", ")}.
- premise: is the situation actually interesting? dramatic-question: is there a clear goal or question? every-beat-matters: could any moment be cut without loss? earned-escalation; believable-reactions; economy: unnecessary details? freshness: predictable or generic? ending: satisfying? worth-the-time: does it feel complete enough to justify ${input.durationSec} seconds?
Retention criteria: ${RETENTION_CRITERIA.join(", ")}.
- first-line: does it grab attention? instant-clarity: is the initial situation understandable at once? curiosity-gap: a clear question, tension or emotional pull? starts-late: does it begin at the most interesting appropriate moment? hook-delivered: does the story pay off the opening's promise? steady-change: any stretch where nothing meaningful changes? payoff: does the ending reward attention?

Prose that reads like a summary or a list (clothing, equipment, steps), or that is too compressed to say aloud naturally, is weak economy and belongs in mustFix. So is an opening that gives away the ending.
Rate each criterion once, quoting the line that shows it. mustFix lists only problems that clearly make the video worse for a viewer, each with a quote and a concrete fix; put nice-to-haves in suggestions. Don't ask for a different story, a joke or more complications unless the story needs them.`,
    user: `${input.brief ? `${input.brief.split("\n\nEARLIER PARTS")[0]}\nJudge it as one video in a series: it must hold a viewer on its own, pay off its small question, and (unless it is the final part) make them need the next part. Don't ask for later parts' beats.\n\n` : `Part ${input.partNumber}\n`}Dramatic question the writer intended: ${input.dramaticQuestion}
The opening promises: ${input.hookPromise}

SCRIPT
${input.narration}`,
  };
}

// ── 8. Targeted revision ──────────────────────────────────────────────

export function scriptRevisionPrompt(input: WriterInput & { plot: Plot; narration: string; hook: string; issues: { id: string; text: string }[]; hookIssue: boolean; brief: string }) {
  const [minWords, maxWords] = targetWordRange(input.durationSec, input.wordsPerSecond);
  return {
    system: `${HOUSE_STYLE}

${STORY_PRINCIPLES}

You repair a script with specific problems. Work in this order:
1. Diagnose each issue: the earliest beat where the real cause belongs (fix the cause, not the symptom).
2. Repair the plot there and update the later beats that depend on it. Copy unchanged beats exactly.
3. Rewrite only the narration affected by those beats. Keep every other sentence exactly as it is.
4. Record a change log entry for every issue id.
Never fix one problem by creating another: no new object, ability or fact unless it is planted before it is used. Keep the story ${minWords}–${maxWords} words.${input.hookIssue ? "" : `\nKeep the opening hook exactly: "${input.hook}"`}`,
    user: `${episodeContext(input)}
${input.brief ? `\n${input.brief}\nThe narration below is this part only; change only beats in this part, and keep the parts list unchanged.\n` : ""}
ISSUES TO FIX
${input.issues.map((i) => `- ${i.id}: ${i.text}`).join("\n")}

CURRENT PLOT
${JSON.stringify(input.plot)}

CURRENT NARRATION
${input.narration}`,
  };
}

// ── 9. Scene breakdown ────────────────────────────────────────────────

export function sceneBreakdownPrompt(input: WriterInput & { plot: Plot; narration: string; title: string; brief: string }) {
  const [minScenes, maxScenes] = sceneCountRange(input.durationSec);
  const hero = input.narrator?.name ?? "the main character";
  return {
    system: `You are the storyboard artist and continuity keeper for a narrated, illustrated short video. The script is final; you never change it.

STEP 1 — visualState: the physical facts every illustration must respect, taken from the plot's states: where ${hero} is through the episode, what they wear and carry, time of day and how the light changes, weather, and rules that hold in every shot.

STEP 2 — scenes: cut the narration into ${minScenes}–${maxScenes} shots, in order. A shot is a picture, not a plot beat; several shots can cover one beat. Each shot's narration is an exact, contiguous excerpt (usually one or two sentences, 4–8 seconds). Joined in order the shots must reproduce the narration word for word: do not rewrite, add or drop anything.
- Each shot shows the exact moment its narration describes, true to visualState and the plot state at that beat. Never show an event the narration doesn't describe.
- Vary the framing: wide establishing shots, medium action, close-ups on hands, faces and key objects, cutaways to other characters or the danger. Never two near-identical framings in a row.
- characters lists only who is visible. A cutaway to someone else does not include ${hero}.
- imagePrompt: one or two specific sentences naming who does what, where, their expression, the key object and the light. Subject only: no art-style words, no text, labels, signs with words or brand names.
- continuity: what must be true in this shot, including anything that changed since the previous one.
- motionPreset supports the moment: slow-zoom-in for tension, pan for movement, still for a reaction.

STEP 3 — bibleUpdate: only what THIS episode adds or changes, using the exact names from the bible. Thread ids are short stable slugs; resolve threads by their existing ids. arcSummary replaces the series summary; under 150 words, including this episode. Record the plot's world rules as constraints and its deliberate mysteries as mysteries when they are new.`,
    user: `${episodeContext(input)}
${input.brief ? `\n${input.brief}\nThe bibleUpdate covers only what THIS part adds.\n` : ""}
PLOT (for states, locations and rules)
${plotText(input.plot)}

FINAL NARRATION — "${input.title}"
${input.narration}`,
  };
}
