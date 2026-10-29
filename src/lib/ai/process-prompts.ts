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

const VOICE = `How the narration sounds:
- An unseen narrator, third person, present tense ("The wax is heated to..."). Never "you", "we" or "I".
- Calm and strictly factual: what happens, in the order it happens. No jokes, puns, opinions, hype words, rhetorical questions or drama.
- Each step says what goes in, what the machine or worker does, and what comes out. Join steps with plain links ("next", "then", "once it cools", "from there").
- Use the real specifics from the research (temperatures, speeds, quantities, times) where they help the viewer picture it. Numbers as they are spoken.
- Write for the ear: flowing spoken sentences, no colons, semicolons, parentheses or lists.
- No brand names or named companies.`;

/** The research the writer may use, numbered so every claim can be checked against it. */
export function researchText(r: ResearchNotes | ResearchRecord, only?: string[]): string {
  const stages = only ? r.stages.filter((s) => only.includes(s.id)) : r.stages;
  return [
    `Product: ${r.product}`,
    `Overview: ${r.overview}`,
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

Split the research's stages into consecutive parts in factory order. Choose the number of parts the process needs: each part should cover one or two stages that fill about ${input.durationSec} seconds of calm narration, no more. Group short stages; never split a stage. Write each part's opening line and where it ends, plainly.`,
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
  const next = input.plan.parts.find((x) => x.part === input.part + 1);
  return {
    system: `${channelBlock(input.channel)}

${VOICE}

You write the narration for Part ${input.part} of ${input.plan.parts.length} of a How It's Made style series, ${minWords}–${maxWords} words (about ${input.durationSec}s at ~${input.wordsPerSecond.toFixed(2)} words/second).
- Open with this line, or a close spoken version of it: ${p.opening}
- Tell every step of this part's stages (${p.stages.join(", ")}), in factory order, using only the research below. Never add a fact, number, material or machine it doesn't contain, and never state anything listed as uncertain.
- A viewer who starts here must understand what is being made and where in the process we are. Don't recap earlier parts beyond that.
- ${last ? "End on the finished product, packed and ready to ship." : `End plainly where the next stage begins (${next?.title ?? p.endsAt}), without a cliffhanger.`}
- If the words run short of the steps, describe each one more simply; never skip a step a later one depends on.`,
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
- tone: jokes, puns, opinions, hype, drama, rhetorical questions, "you", or brand names.

Severity:
- blocking: a stated fact or number that contradicts the research.
- significant: an unsupported claim, steps out of order, a confusing jump, or a tone problem a viewer would notice.
- minor: a nitpick that doesn't affect understanding or accuracy.
kind is "contradiction" for factual and order problems, "creative-concern" for tone and style.

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
