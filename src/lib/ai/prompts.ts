import { CRITERIA } from "@/lib/schemas/concept";
import type { StoryBible } from "@/lib/schemas/story-bible";
import { CATEGORIES, categoryLabel, sceneCountRange, styleSpec as styleSpecFor, targetWordRange } from "@/lib/constants";
import { CONCEPT_DEVELOPER } from "@/lib/ai/concept-prompt";

const PRESET_CATEGORIES = CATEGORIES.filter((c) => c.value !== "custom" && c.value !== "mixed");

/*
 * Prompt library. System prompts carry stable rules; user prompts carry the
 * per-call material. Kept in one place so the house voice stays consistent.
 */

const TRUTHFULNESS = `Truthfulness:
- Never invent statistics, policies, procedures, named incidents, organisations or technical specifics and present them as fact.
- Real-world explanations must stick to well-documented general knowledge. When unsure, describe it generally ("many airports use...") rather than inventing precise numbers.
- Fictional or hypothetical material must be framed so viewers can tell (e.g. a hypothetical premise, or a story-world character), never disguised as reported fact.`;

export const HOUSE_STYLE = `You write narrated, illustrated short vertical story videos (TikTok, YouTube Shorts, Reels) on whatever subject the producer chooses: hidden systems, history, science, fiction, true stories, what-ifs and more.

Voice:
- Tell it as a story, read aloud by one narrator: flowing spoken sentences joined by cause and time ("so", "because", "until", "which meant", "by the time"). Mix short and medium sentences; never a string of fragments.
- Write for the ear: no colons, semicolons, parentheses or lists; no one-word sentences for effect more than once per episode.
- Narrator perspective is set per story. With no narrator character, use second person ("you") in the present tense.
- Open inside the situation. No greetings, no "Have you ever wondered", no "In this video", no channel plugs.
- Clear cause and effect: every moment follows from the one before. Concrete actions and details over mood.
- Believable and grounded. Specific where it is true; honest about uncertainty where it is not.
- Avoid AI clichés: "little did you know", "buckle up", "let's dive in", "here's the thing", "spoiler alert", "mind-blowing", "but here's where it gets interesting", "the answer may surprise you", rhetorical question chains, "game-changer", "delve", and forced-twist formulas such as "the real danger isn't X, it's Y", "what nobody realizes is", "the surprising part is", "but the real problem is".
- No engagement bait. Never ask viewers to like, follow, comment or subscribe.
- Endings deliver a real payoff AND open a genuine new question. Never a cheap cliffhanger that withholds the point of the episode.

${TRUTHFULNESS}`;

export function criteriaGuide(): string {
  return CRITERIA.map((c) => `- ${c.key}: ${c.label}`).join("\n");
}

export function ideationPrompt(input: { category: string; customDirection?: string | null; count: number; avoidTitles: string[]; character?: NarratorProfile | null }) {
  const ownTopic = input.category === "custom";
  const c = input.character;
  const starring = c
    ? `\n## Series character\n${narratorBlock(c)}\n\nEvery concept is the opening situation of a series starring ${c.name}. Pitch situations an ordinary person like ${c.name} could realistically land in, where their personality and choices matter. Titles name the situation plainly, with or without their name (e.g. "${c.name} Breaks Down in the Middle of Nowhere", "Three Days Snowed In at a Truck Stop"). Write premise, logline and openingSituation about ${c.name}, not "you".\n`
    : "";
  const brief = ownTopic
    ? `The producer's brief. Every concept must be about this, in its subject, genre and tone:\n${input.customDirection}\n\nSet each concept's category to a short label for its subject.`
    : input.category === "mixed"
      ? `Category: any mix of these.\n${PRESET_CATEGORIES.map((c) => `- ${c.label}: ${c.description}`).join("\n")}`
      : `Category: ${categoryLabel(input.category)}. ${CATEGORIES.find((c) => c.value === input.category)?.description ?? ""}\nFind everyday situations within this category; it is a source of situations, not a reason to get technical or extreme.`;
  return {
    system: `${CONCEPT_DEVELOPER}

${TRUTHFULNESS}`,
    user: `Pitch exactly ${input.count} concepts.

${brief}
${!ownTopic && input.customDirection ? `\nCreative direction from the producer: ${input.customDirection}\n` : ""}${starring}
Each concept must have a different central situation.
Do not repeat the central situation of any existing story (reusing a familiar setting is fine):
${input.avoidTitles.length ? input.avoidTitles.map((t) => `- ${t}`).join("\n") : "- (none yet)"}`,
  };
}

export function evaluationPrompt(input: { concepts: { title: string; premise: string; logline: string; factMode: string; seriesPotential: string }[]; existingTitles: string[] }) {
  return {
    system: `You are a demanding story editor for short-form vertical video. You score concepts consistently on a 1–10 integer scale per criterion, where 5 is an average pitch and 9–10 is rare.
These are editorial heuristics, not predictions of view counts.

Criteria:
${criteriaGuide()}

The audience is everyday adults scrolling short-form video, not experts. Favor clear, familiar, relatable situations over clever, unusual or technical ones.
- relatability, curiosity, hookStrength and audienceAppeal: high only if an ordinary person would understand the idea within two seconds, could picture themselves in it, and would want to know what happens next.
- A concept that cannot be explained to a friend in one plain sentence, needs world-building or specialist knowledge, has manufactured stakes, or rests on a forced twist ("the real danger isn't X, it's Y") scores at most 4 on curiosity, hookStrength and audienceAppeal.
- seriesPotential: a credible natural continuation scores well; two strong episodes beat six stretched ones. Do not reward convoluted plots.
For researchFeasibility, 10 means easy to tell accurately with well-documented general knowledge; 1 means it hinges on obscure, disputed or unverifiable specifics.
For originality, compare against the producer's existing stories: penalise only repeating the same central situation, not reusing a familiar setting (lost luggage and a missed connection are different stories).
Give one honest sentence of rationale per score. Evaluate every concept, using its index.`,
    user: `Existing stories:
${input.existingTitles.length ? input.existingTitles.map((t) => `- ${t}`).join("\n") : "- (none)"}

Concepts to evaluate:
${input.concepts
  .map(
    (c, i) => `[${i}] ${c.title}
Premise: ${c.premise}
Logline: ${c.logline}
Fact mode: ${c.factMode}
Series potential: ${c.seriesPotential}`,
  )
  .join("\n\n")}`,
  };
}

export function hooksPrompt(input: { title: string; premise: string; openingSituation: string; factMode: string; partNumber: number; previously?: string; count?: number; narrator?: NarratorProfile | null }) {
  return {
    system: `${HOUSE_STYLE}

You write opening hooks: the first 3–5 seconds of narration. A hook must put the viewer inside the moment immediately.
Write at least one of each type: RELATABLE (an ordinary moment going wrong), SURPRISING_FACT (a true, well-documented surprise — no invented numbers), IMMEDIATE_DANGER (stakes that land right now). You may add QUESTION or OTHER.
Score every hook with the standard criteria (1–10 integers):
${criteriaGuide()}`,
    user: `Story: ${input.title}
Premise: ${input.premise}
Opening situation: ${input.openingSituation}
Fact mode: ${input.factMode}
Part: ${input.partNumber}
${input.previously ? `Previously: ${input.previously}\n` : ""}${input.narrator ? `\n${narratorBlock(input.narrator)}\nWrite every hook in ${input.narrator.name}'s narrating voice.\n` : ""}
Write ${input.count ?? 4} distinct hooks.`,
  };
}

export function bibleContextBlock(bible: StoryBible): string {
  const open = bible.unresolvedThreads.filter((t) => t.status === "open");
  return `STORY BIBLE (canonical — do not contradict)
Premise: ${bible.premise}
Tone: ${bible.tone}
Perspective: ${bible.narrativePerspective}
Arc so far: ${bible.arcSummary || "(first episode)"}
Characters:
${bible.characters.map((c) => `- ${c.name} (${c.role}): ${c.description}. Drawn as: ${c.visualDescription}`).join("\n") || "- none yet"}
Locations:
${bible.locations.map((l) => `- ${l.name}: ${l.description}`).join("\n") || "- none yet"}
Timeline:
${bible.timeline.map((e) => `- Part ${e.part}.${e.order}: ${e.event}`).join("\n") || "- none yet"}
Established story facts:
${bible.establishedFacts.map((f) => `- [${f.kind}] ${f.statement}`).join("\n") || "- none yet"}
Technical facts already used:
${bible.technicalFacts.map((f) => `- [${f.kind}] ${f.statement}`).join("\n") || "- none yet"}
Already revealed (do not re-reveal as new):
${bible.revealedInformation.map((r) => `- ${r}`).join("\n") || "- nothing yet"}
Open threads:
${open.map((t) => `- [${t.id}] ${t.description} (since Part ${t.introducedPart})`).join("\n") || "- none"}
Mysteries: ${bible.mysteries.join("; ") || "none"}
Constraints:
${bible.constraints.map((c) => `- ${c}`).join("\n") || "- none"}
Recurring visuals:
${bible.visualStyle.recurringVisuals.map((v) => `- ${v.name}: ${v.description}`).join("\n") || "- none"}`;
}

export type WriterInput = {
  storyId: string;
  title: string;
  premise: string;
  factMode: string;
  partNumber: number;
  durationSec: number;
  wordsPerSecond: number;
  /** Candidate openings to draw on; the writer picks and adapts one. */
  hookIdeas: string[];
  /** When set, the episode must open with exactly this line. */
  requiredHook?: string | null;
  narrator?: NarratorProfile | null;
  bible: StoryBible;
  previousEpisodes: { partNumber: number; title: string; summary: string }[];
  latestEpisode: { partNumber: number; title: string; narration: string; keyReveals: string[]; unresolvedQuestions: string[] } | null;
  direction?: string | null;
};

export type NarratorProfile = {
  name: string;
  perspective: "FIRST_PERSON" | "THIRD_PERSON";
  tagline: string;
  personality: string;
  backstory: string;
  speakingStyle: string;
};

export function narratorBlock(n: NarratorProfile): string {
  const pov =
    n.perspective === "FIRST_PERSON"
      ? `${n.name} narrates in the first person ("I"), past tense, like telling a friend what happened. Viewers experience everything through ${n.name}'s eyes and decisions.`
      : `Narrate in close third person, past tense, following ${n.name}. Viewers experience everything through ${n.name}'s eyes and decisions.`;
  return `NARRATOR AND HERO: ${n.name} — ${n.tagline}
${pov}
Personality: ${n.personality}
Background: ${n.backstory}
How ${n.name} talks: ${n.speakingStyle}
${n.name} is the same person in every episode: keep their voice, habits and knowledge consistent, and let their personality drive their choices.`;
}

export function writerPrompt(input: WriterInput) {
  const [minWords, maxWords] = targetWordRange(input.durationSec, input.wordsPerSecond);
  const [minScenes, maxScenes] = sceneCountRange(input.durationSec);
  const isContinuation = input.partNumber > 1;
  const hero = input.narrator?.name ?? "the main character";

  return {
    system: `${HOUSE_STYLE}

You are the head writer. You write one episode in two steps, in this order.

STEP 1 — storyNarration: write the whole episode as one continuous story told aloud, ${minWords}–${maxWords} words (about ${input.durationSec}s at ~${input.wordsPerSecond.toFixed(2)} words/second for this narrator). Write it as a story, not as captions.
Story spine (adapt the proportions; every step must cause the next):
1. Situation: within the first sentence or two, the viewer knows who, where and what is at stake. Start at the moment things go wrong or are about to.
2. Problem: what ${hero} needs to do or get out of, and why it matters now.
3. Attempt: ${hero} tries something, and we see the concrete actions.
4. Setback: it doesn't fully work, or a new complication appears because of what they did.
5. Smart move: ${hero} does something genuinely useful, one real, practical idea the viewer could use themselves, explained naturally through the action.
6. Result: what that changes, with a real payoff in this episode.
7. Next: end on the next concrete problem or decision, so Part ${input.partNumber + 1} has somewhere to go. Not a vague mystery; a situation.
Rules for storyNarration:
- Tell it in time order. No flash-forwards, no "one second ago", no rewinding after the opening.
- The opening line is the hook: it drops the viewer straight into the situation and flows directly into the next sentence. Use the hook ideas below as inspiration; pick the best and adapt it so it fits the story you are telling.
- Put any real-world caution ("usually", "in most places") once, where the advice is given, not throughout the drama.
- Numbers written as they are spoken; no abbreviations that read awkwardly.

STEP 2 — scenes: cut storyNarration into ${minScenes}–${maxScenes} shots, in order. Each shot's narration is an exact, contiguous excerpt of storyNarration (usually one or two sentences, 4–8 seconds). Joined in order, the shots must reproduce storyNarration word for word: do not rewrite, add or drop anything.
- Each shot shows ONE clear action or moment from its narration. imagePrompt names who is doing what, where, and the key object. At most three figures; ${hero} is in most shots.
- imagePrompt describes only the subject; no art-style words, no text/labels/signs with words, no brand names.
- Characters use the exact names from the bible; new characters need a stable visual description.
- motionPreset supports the beat: slow-zoom-in for tension, pan for movement, still for a reaction or punchline.

selectedHook is the opening line(s) of storyNarration, copied exactly.

Truthfulness:
- List in "claims" every real-world factual claim the narration makes, with its scene and classification:
  ESTABLISHED_FACT (widely documented), PLAUSIBLE_EXAMPLE (illustrative, framed as typical/possible), FICTIONAL (story-world), NEEDS_VERIFICATION (you are not certain).
- Prefer general truthful phrasing over invented precision. Survival and safety advice must be sound.

Continuity:
- "bibleUpdate" lists only what THIS episode adds or changes. Thread ids must be short stable slugs; resolve threads by their existing ids.
- arcSummary in bibleUpdate replaces the series summary; keep it under 150 words and include this episode.`,
    user: `Story ID: ${input.storyId}
Series title: ${input.title}
Premise: ${input.premise}
Fact mode: ${input.factMode}
Part: ${input.partNumber}
${input.narrator ? `\n${narratorBlock(input.narrator)}\n` : ""}
${
  input.requiredHook
    ? `Opening line (required, verbatim): "${input.requiredHook}"`
    : `Hook ideas (inspiration, best first):\n${input.hookIdeas.map((h) => `- ${h}`).join("\n") || "- (none; write your own)"}`
}
${input.direction ? `Producer direction: ${input.direction}\n` : ""}
${bibleContextBlock(input.bible)}
${
  isContinuation
    ? `
EARLIER EPISODES (approved)
${input.previousEpisodes.map((e) => `- Part ${e.partNumber} "${e.title}": ${e.summary}`).join("\n")}

MOST RECENT EPISODE IN FULL (Part ${input.latestEpisode?.partNumber}: "${input.latestEpisode?.title}")
${input.latestEpisode?.narration}
Key reveals: ${input.latestEpisode?.keyReveals.join("; ")}
It left these questions open: ${input.latestEpisode?.unresolvedQuestions.join("; ")}

Write Part ${input.partNumber}. It must:
- Pick up directly from where Part ${input.partNumber - 1} ended, with a one-line re-orientation inside the opening, not a recap.
- Move the situation forward with a new concrete problem and a real result.
- Not repeat already-revealed information as if new.
- End on the next concrete problem or decision.`
    : `
Write Part 1, the opening episode. It must stand alone as a satisfying story while leaving ${hero} facing a clear next problem.`
}`,
  };
}

export function revisionPrompt(input: { draftJson: string; factIssues: string[]; continuityIssues: string[]; lengthIssues: string[] }) {
  return {
    system: `${HOUSE_STYLE}

You are revising an episode draft to fix specific problems while keeping everything else as close to the original as possible. Return the complete revised episode in the same structure.
Keep storyNarration and the scenes in sync: change the story in storyNarration first, then make the scenes' narration the exact contiguous excerpts of it again. Keep the story flowing; fixes must read naturally aloud.
For unsupported factual claims: remove the unsupported specificity, reframe as clearly illustrative, or move it into the story world. Do not replace one unverified specific with another.`,
    user: `Problems to fix:
${[...input.factIssues, ...input.continuityIssues, ...input.lengthIssues].map((i) => `- ${i}`).join("\n")}

Current draft (JSON):
${input.draftJson}`,
  };
}

export function factReviewPrompt(input: { title: string; factMode: string; narrationByScene: { sceneNumber: number; narration: string }[]; declaredClaims: { claim: string; sceneNumber: number; classification: string }[] }) {
  return {
    system: `You are a meticulous fact-checker for short educational story videos. You do not have web access, so be explicit about the limits of your knowledge.

For every factual-sounding statement in the narration (not only the declared claims), assess:
- widely-documented: you are highly confident it is broadly documented general knowledge.
- plausible-unverified: plausible, but you cannot confirm the specifics; must be flagged for a human.
- fictional-framed: clearly story-world or hypothetical as presented.
- dubious: likely wrong or misleading.
- presented-as-fact-but-unsupported: stated as fact with invented-seeming precision (numbers, named procedures, policies, incidents).

Give a concrete suggestedRevision for anything not widely-documented or fictional-framed. verificationHints name the kind of authoritative source a human should check (agency, standard, manual) — never invent URLs or citations.
Verdict: "pass" if nothing needs attention; "needs-revision" if any dubious or presented-as-fact-but-unsupported claim exists; otherwise "needs-review".`,
    user: `Episode: ${input.title}
Fact mode: ${input.factMode}

Narration by scene:
${input.narrationByScene.map((s) => `[${s.sceneNumber}] ${s.narration}`).join("\n")}

Writer-declared claims:
${input.declaredClaims.map((c) => `- (scene ${c.sceneNumber}, ${c.classification}) ${c.claim}`).join("\n") || "- none declared"}`,
  };
}

export function continuityPrompt(input: { bible: StoryBible; previousSummaries: string[]; draftSummary: string; narrationByScene: { sceneNumber: number; narration: string }[]; partNumber: number }) {
  return {
    system: `You are the continuity supervisor for a serialized story. Compare a new episode draft with the canonical story bible and earlier episodes.
Flag: character contradictions, location contradictions, impossible timelines, repeated reveals presented as new, broken causal chains, unexplained new facts that the story relies on, and conflicts with established real-world facts.
Severity "material" means a viewer who watched earlier parts would notice and be confused; "minor" otherwise.
Do not flag deliberate new developments that are set up and explained.`,
    user: `${bibleContextBlock(input.bible)}

Earlier episode summaries:
${input.previousSummaries.map((s) => `- ${s}`).join("\n") || "- none"}

NEW DRAFT — Part ${input.partNumber}
Summary: ${input.draftSummary}
${input.narrationByScene.map((s) => `[${s.sceneNumber}] ${s.narration}`).join("\n")}`,
  };
}

export function sceneRewritePrompt(input: { title: string; sceneNumber: number; before: string; current: string; after: string; instruction?: string | null; bible: StoryBible }) {
  return {
    system: `${HOUSE_STYLE}

Rewrite ONE scene of an existing episode. Keep its role in the story, keep roughly the same length (±15% words), and make it flow from the previous scene into the next. Return new narration plus an updated subject-only imagePrompt and composition for the illustration.`,
    user: `Episode: ${input.title}
${bibleContextBlock(input.bible)}

Previous scene narration: ${input.before || "(none — this is the opening)"}
CURRENT scene ${input.sceneNumber} narration: ${input.current}
Next scene narration: ${input.after || "(none — this is the ending)"}
${input.instruction ? `Producer instruction: ${input.instruction}` : "Make it sharper and more natural to say aloud."}`,
  };
}

export function imageReviewPrompt(sceneDescription: string) {
  return `You are reviewing an illustration for a minimalist stick-figure explainer video.
Intended scene: ${sceneDescription}
Answer strictly in JSON matching the schema. Fail the image if it contains any readable text, letters, numbers or logos; photorealism or 3D shading; gradients; or if it clearly does not depict the intended scene.`;
}

export function characterPrompt(input: { brief: string; existingNames: string[] }) {
  return {
    system: `You design recurring narrator-heroes for a short-form animated story account (TikTok, Reels, Shorts) in the style of stick-figure survival and everyday-disaster series.

A great series character:
- Is an ordinary, likeable person viewers could know: a specific job, habits and a way of talking, not a superhero or an expert in everything.
- Has a clear personality that drives choices and gives small moments of humour, so viewers come back for them, not just the situation.
- Is practical enough to make smart moves, and flawed enough to make mistakes that create story.
- Can carry many different everyday situations (stranded, stuck, lost, things going wrong at home, work or on the road).
- Is instantly recognisable as a simple stick figure: one distinctive silhouette detail (hat, beard, build), one signature colour item, one prop.

Keep everything grounded, warm and family-friendly. No real people, brands or copyrighted characters.`,
    user: `Producer's brief: ${input.brief}

Design one character from this brief.${input.existingNames.length ? ` Make them clearly different from the existing characters: ${input.existingNames.join(", ")}.` : ""}`,
  };
}

export function characterSheetPrompt(input: { name: string; visualDescription: string; signatureColor: string; styleKey: string }) {
  return [
    `STYLE: ${styleSpecFor(input.styleKey)}`,
    `CHARACTER REFERENCE SHEET for ${input.name}: ${input.visualDescription}`,
    `Their signature colour is ${input.signatureColor}; use it on their signature item.`,
    "Show the same character three times side by side on a plain off-white background: front view standing, three-quarter view mid-stride, and one expressive action pose using their prop. Full body, evenly spaced, same scale, nothing else in the frame.",
    "Landscape 3:2 frame.",
    "Absolutely no text, words, letters, numbers, labels, logos or watermarks.",
  ].join("\n");
}
