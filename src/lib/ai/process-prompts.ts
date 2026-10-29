import { channelBlock, type ChannelGuide } from "@/lib/schemas/channel";
import type { ProcessPlan, ResearchNotes, ResearchRecord } from "@/lib/schemas/process";
import { sceneCountRange, targetWordRange } from "@/lib/constants";

/*
 * Prompts for process explainers ("How it's made"): research, plan, narrate,
 * fact-check against the research, revise, storyboard.
 */

export type ProcessPromptInput = {
  channel: ChannelGuide;
  title: string;
  premise: string;
  durationSec: number;
  wordsPerSecond: number;
};

const VOICE = `Who it's for: ordinary adults with everyday knowledge, not engineers or chemists. Explain it the way you'd tell a curious friend. If a viewer would have to look up a word, the script has failed.

How the narration sounds:
- An unseen narrator, third person, present tense ("The wax is heated until..."). Never "you", "we" or "I".
- Calm and factual: what happens, in the order it happens. No jokes, puns, opinions, hype words, rhetorical questions or drama.
- Describe things, don't name them. Say what a machine, chemical or part is or does, and leave out its industry name: "it's pumped through a heated tube to 130 degrees", not "it's pumped through a coil cooker, a heated tube, to 130 degrees". Never give a name and then explain it. Use a name only when it is an everyday word ("oven", "conveyor belt", "roller") or the product itself.
- Plain words throughout: "a chemical mix", not "white liquor"; "pulp", not "furnish".
- Help the viewer picture it with everyday comparisons ("a brown, oatmeal-like mush", "about as thick as a pancake"). Comparisons describe what things are like; they never add facts.
- One or two striking numbers per video at most, said so they mean something ("about 160 degrees, well above boiling"). Never a run of figures, ranges or alternatives.
- Each main step says what goes in, what happens to it, and what comes out. Join steps with plain links ("next", "then", "once it cools", "from there").
- Never list more than two or three things in a row. Write for the ear: flowing spoken sentences, no colons, semicolons or parentheses.
- No brand names or named companies.`;

/** The research the writer may use, numbered so every claim can be checked against it. */
export function researchText(r: ResearchNotes | ResearchRecord, only?: string[]): string {
  const stages = only ? r.stages.filter((s) => only.includes(s.id)) : r.stages;
  return [
    `Product: ${r.product}`,
    `Overview: ${r.overview}`,
    ...("mainRoute" in r && r.mainRoute ? [`Main route (follow this): ${r.mainRoute}`] : []),
    ...stages.map((s) => `${s.id} ${s.name}\n${s.steps.map((st) => `  - ${st.what}${st.details ? ` (${st.details})` : ""}`).join("\n")}`),
    `Uncertain, never state as fact: ${r.uncertain.join("; ") || "none"}`,
  ].join("\n");
}

export function planText(plan: ProcessPlan): string {
  return plan.parts.map((p) => `Part ${p.part}: ${p.title} | stages ${p.stages.join(", ")} | opens: ${p.opening} | ends at: ${p.endsAt}`).join("\n");
}

export function researchSearchPrompt(input: { product: string; premise: string; arc: string | null }) {
  return {
    system: `You are the researcher for a factual video series in the style of the TV show How It's Made. Use web search to find out exactly how the product is made in a modern factory today.

Report every major stage in factory order, from raw materials to the finished, packed product. For each stage give concrete, checkable details: the materials, the machines and what they do, temperatures, pressures, speeds, quantities, durations and how quality is checked. Prefer manufacturers, industry associations, engineering and educational sources, and encyclopedias. Say plainly where sources disagree or where a detail could not be found. Do not guess. Cite your sources.`,
    user: `Product: ${input.product}
${input.premise}${input.arc ? `\nThe pitch sketched these stages (check them, don't trust them): ${input.arc}` : ""}`,
  };
}

export function researchNotesPrompt(input: { product: string; text: string; sources: { n: string; title: string; url: string }[]; minStages: number }) {
  return {
    system: `You turn a researcher's report into structured notes a scriptwriter will use, and that every line of the script will be checked against. Use only what the report says: never add a fact, number or step it doesn't contain. Where the report is unsure or sources disagree, put it in uncertain instead of in a step.
mainRoute: when there are several ways in (different raw materials or methods), name the most common one today. The stages follow that route; mention other routes in a step only where they join it.
Split the process into ${input.minStages}–10 stages in factory order (raw materials first, packing last), each a distinct, visual phase with its own steps.`,
    user: `Product: ${input.product}

SOURCES
${input.sources.map((s) => `[${s.n}] ${s.title} — ${s.url}`).join("\n") || "(none listed)"}

REPORT
${input.text}`,
  };
}

export function processPlanPrompt(input: ProcessPromptInput & { research: ResearchNotes; parts: [number, number] }) {
  return {
    system: `You plan a How It's Made style series for one product, told across ${input.parts[0]}–${input.parts[1]} videos of about ${input.durationSec} seconds each.

${channelBlock(input.channel)}

Split the research's stages into consecutive parts in factory order. Choose the number of parts the process needs: each part should cover one or two stages that fill about ${input.durationSec} seconds of calm narration, no more. Group short stages; never split a stage. The parts are one continuous story cut into pieces: each part's first step follows straight on from the previous part's last step.`,
    user: `${input.title}
${input.premise}

RESEARCH
${researchText(input.research)}`,
  };
}

export function processNarrationPrompt(input: ProcessPromptInput & { research: ResearchNotes; plan: ProcessPlan; part: number; earlier: string[] }) {
  const [minWords, maxWords] = targetWordRange(input.durationSec, input.wordsPerSecond);
  const p = input.plan.parts.find((x) => x.part === input.part)!;
  const last = input.part === input.plan.parts.length;
  return {
    system: `${channelBlock(input.channel)}

${VOICE}

You write the narration for Part ${input.part} of ${input.plan.parts.length} of a How It's Made style series, ${minWords}–${maxWords} words (about ${input.durationSec}s at ~${input.wordsPerSecond.toFixed(2)} words/second).
- The parts are one continuous story cut into pieces: played back to back they must sound like a single video. Never mention parts, videos, stages or what comes next, and never use framing like "picks up", "this part", "next" as a preview, "so far" or "in the next step we'll see".
- ${input.part === 1 ? `Open by saying plainly what the product starts as: ${p.opening}` : `Begin straight into the next step (${p.opening}), as if the previous sentence had just ended. Naming the product or the material in that first sentence is fine; a recap is not.`}
- Tell the main steps of this part's stages (${p.stages.join(", ")}) that a viewer can picture, in factory order, folding small steps together. Never skip a step a later one depends on.
- Follow the main route. Another route (a different raw material or method) gets one short sentence at most.
- Use only the research below. Simplifying is right; adding a fact, number, material or machine it doesn't contain, or stating anything listed as uncertain, is not.
- ${last ? "End on the finished product, packed and ready to ship." : `End on the last step itself (${p.endsAt}), told like any other step: no summary, no announcement of what happens next, no cliffhanger.`}
- If the words run short of the steps, describe each one more simply.`,
    user: `${input.title}

PLAN
${planText(input.plan)}

RESEARCH FOR THIS PART
${researchText(input.research, p.stages)}
${input.earlier.length ? `\nEARLIER PARTS, AS NARRATED\n${input.earlier.map((t, i) => `Part ${i + 1}: ${t}`).join("\n\n")}` : ""}`,
  };
}

const AUDIT_RULES = `You are an independent fact-checker and editor for a How It's Made style video. You did not write this script. Check it against the research notes, which are the only accepted source of facts, and report real problems only.

Look for:
- unsupported-claim: a fact, number, material, machine or step the research doesn't contain, or something it lists as uncertain stated as fact.
- temporal: steps told out of factory order.
- missing-connection: a step that doesn't follow from the one before, or a later step relying on something never explained.
- clarity: a viewer would be confused about what is being made, where in the process we are, or what a machine does.
- series-continuity: it contradicts an earlier part.
- tone: jokes, puns, opinions, hype, drama, rhetorical questions, "you", or brand names. Also any framing that breaks the one continuous story: mentioning parts or videos, recaps of earlier parts, "picks up", or announcing what happens next.
- too-technical: the audience is ordinary adults, not experts. An industry name for a machine, chemical or part where a plain description would do (including a name followed by its explanation, like "a coil cooker, a heated tube"), a run of numbers, ranges or alternatives, a list of more than three items, or detail beyond what a viewer can picture.

Simplifying is not a problem: leaving out minor steps, alternative routes or numbers, or using an everyday comparison, is intended. Only a simplification that makes a statement wrong is an issue.

Severity:
- blocking: a stated fact or number that contradicts the research.
- significant: an unsupported claim, steps out of order, a confusing jump, a tone problem a viewer would notice, or narration too technical for an ordinary viewer.
- minor: a nitpick that doesn't affect understanding or accuracy.
kind is "contradiction" for factual and order problems, "creative-concern" for tone, style and too-technical.

First list intendedUnknowns: anything deliberately left out. Then report issues, most severe first, at most eight, each quoting the script's exact words as evidence. If the script is accurate and clear, return no issues: never invent problems.`;

export function processAuditPrompt(input: { title: string; research: ResearchNotes; plan: ProcessPlan; part: number; narration: string; earlier: string[]; previous?: { id: string; text: string }[] }) {
  const p = input.plan.parts.find((x) => x.part === input.part)!;
  return {
    system: AUDIT_RULES,
    user: `${input.title}: Part ${input.part} of ${input.plan.parts.length} (${p.title}). Stages in this part: ${p.stages.join(", ")}. Later stages belong to later parts.
${input.previous?.length ? `\nEARLIER ISSUES (the writer was asked to fix these; for each id, say in previousIssues whether it is now resolved, and list any that remain in issues again):\n${input.previous.map((x) => `- ${x.id}: ${x.text}`).join("\n")}\n` : ""}
RESEARCH NOTES
${researchText(input.research)}
${input.earlier.length ? `\nEARLIER PARTS\n${input.earlier.map((t, i) => `Part ${i + 1}: ${t}`).join("\n\n")}\n` : ""}
SCRIPT
${input.narration}`,
  };
}

export function processRevisionPrompt(input: ProcessPromptInput & { research: ResearchNotes; plan: ProcessPlan; part: number; narration: string; issues: { id: string; text: string }[] }) {
  const [minWords, maxWords] = targetWordRange(input.durationSec, input.wordsPerSecond);
  const p = input.plan.parts.find((x) => x.part === input.part)!;
  return {
    system: `${channelBlock(input.channel)}

${VOICE}

You fix specific problems in one part of a How It's Made style script. Fix each issue at its cause using only the research, rewrite only the sentences affected, and keep every other sentence exactly as it is. Keep it ${minWords}–${maxWords} words. Record a change log entry for every issue id.`,
    user: `ISSUES TO FIX
${input.issues.map((i) => `- ${i.id}: ${i.text}`).join("\n")}

RESEARCH FOR THIS PART
${researchText(input.research, p.stages)}

CURRENT SCRIPT (Part ${input.part}: ${p.title})
${input.narration}`,
  };
}

export function processBreakdownPrompt(input: ProcessPromptInput & { research: ResearchNotes; plan: ProcessPlan; part: number; narration: string; title: string }) {
  const [minScenes, maxScenes] = sceneCountRange(input.durationSec);
  const p = input.plan.parts.find((x) => x.part === input.part)!;
  return {
    system: `You are the storyboard artist for a narrated, stick-figure illustrated How It's Made style video. The script is final; you never change it.

STEP 1 — visualState: the physical facts every illustration must respect. setting: the factory areas this part shows. timeAndLight: factory lighting. weather: "indoors". heroSituation: the product's state as it moves through this part (what it looks like at the start and at the end). heroLook: the workers (plain stick figures in work clothes and safety gear) and the key machines. rules: what holds in every shot.

STEP 2 — scenes: cut the narration into ${minScenes}–${maxScenes} shots, in order. Each shot's narration is an exact, contiguous excerpt (usually one or two sentences, 4–8 seconds); joined in order they reproduce the narration word for word. Do not rewrite, add or drop anything.
- Each shot shows exactly the step its narration describes: the material, the machine doing its job, a worker's hands, the product at that stage. Never show a step the narration doesn't describe.
- Vary the framing: wide shots of the line, medium shots of a machine, close-ups of the material and the product. Never two near-identical framings in a row.
- characters: leave empty unless a named character is visible (there are none in this series).
- imagePrompt: one or two specific sentences: what the machine or worker is doing, to what material, what it looks like at this moment. Subject only: no art-style words, no text, labels, numbers, dials with readings, or brand names.
- continuity: what must be true in this shot, including how the product looks at this stage.
- motionPreset: slow-zoom-in for detail, pan for a moving line, still for a finished result.

STEP 3 — bibleUpdate: leave every list empty. arcSummary: one sentence saying what this part shows.`,
    user: `${input.title}
Part ${input.part} of ${input.plan.parts.length}: ${p.title}

RESEARCH (for what things look like)
${researchText(input.research, p.stages)}

FINAL NARRATION — "${input.title}"
${input.narration}`,
  };
}
