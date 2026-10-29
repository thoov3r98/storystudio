import { CRITERIA } from "@/lib/schemas/concept";
import type { StoryBible } from "@/lib/schemas/story-bible";
import { CATEGORIES, categoryLabel, styleSpec as styleSpecFor } from "@/lib/constants";
import { CONCEPT_DEVELOPER } from "@/lib/ai/concept-prompt";

const PRESET_CATEGORIES = CATEGORIES.filter((c) => c.value !== "custom" && c.value !== "mixed");

/*
 * Prompt library. System prompts carry stable rules; user prompts carry the
 * per-call material. Kept in one place so the house voice stays consistent.
 */

const TRUTHFULNESS = `Grounding:
- Keep practical details believable, and never show something dangerous as a safe thing to copy.
- Don't invent statistics or named real incidents. Stories with a fictional hero need no disclaimers or hedging.`;

export const HOUSE_STYLE = `You write narrated, illustrated short vertical story videos (TikTok, YouTube Shorts, Reels) on whatever subject the producer chooses: hidden systems, history, science, fiction, true stories, what-ifs and more.

Voice:
- Tell it as a story, read aloud by one narrator: mostly flowing spoken sentences joined by cause and time ("so", "because", "until", "which meant", "by the time"). Short punchy lines are welcome for panic, inner thoughts and jokes, but never a staccato run of fragments.
- Write for the ear: no colons, semicolons, parentheses or lists.
- Narrator perspective is set per story. With no narrator character, use second person ("you") in the present tense.
- Open inside the situation. No greetings, no "Have you ever wondered", no "In this video", no channel plugs.
- Clear cause and effect: every moment follows from the one before. Concrete actions and details over mood.
- Grounded in how a real person would feel and react, even when the situation itself is impossible. Never over-explain.
- Avoid AI clichés: "little did you know", "buckle up", "let's dive in", "here's the thing", "spoiler alert", "mind-blowing", "but here's where it gets interesting", "the answer may surprise you", rhetorical question chains, "game-changer", "delve", and forced-twist formulas such as "the real danger isn't X, it's Y", "what nobody realizes is", "the surprising part is", "but the real problem is".
- No engagement bait. Never ask viewers to like, follow, comment or subscribe.
- Endings pay off what the episode set up. A cliffhanger is fine when it is earned, never one that withholds the point of the episode.

${TRUTHFULNESS}`;

export function criteriaGuide(): string {
  return CRITERIA.map((c) => `- ${c.key}: ${c.label}`).join("\n");
}

export function ideationPrompt(input: { category: string; customDirection?: string | null; count: number; avoidTitles: string[]; character?: NarratorProfile | null }) {
  const ownTopic = input.category === "custom";
  const c = input.character;
  const starring = c
    ? `\n## Series character\n${narratorBlock(c)}\n\nEvery concept is the opening situation of a series starring ${c.name}. Pitch situations where ${c.name}'s personality and choices matter (everyday ones unless the producer's premise says otherwise). Titles name the situation plainly, with or without their name (e.g. "${c.name} Breaks Down in the Middle of Nowhere", "Three Days Snowed In at a Truck Stop"). Write premise, logline and openingSituation about ${c.name}, not "you".\n`
    : "";
  const direction = input.customDirection?.trim();
  // The producer's direction is the premise itself, never a loose theme: it outranks the category and the realism defaults.
  const premise = direction
    ? `## The producer's premise (follow it exactly)
${direction}

- Keep its central situation exactly as given, even if it is impossible, apocalyptic or supernatural. Never swap it for a smaller, realistic or explainable version (e.g. "everyone in the world vanished" must not become "the building was evacuated").
- Every concept is a different way into THIS premise: a different first moment, angle or first problem. Not a different premise.
- Don't explain how or why it happened unless the producer does; the mystery can stay open.
`
    : "";
  const brief = ownTopic
    ? `Set each concept's category to a short label for its subject.`
    : input.category === "mixed"
      ? `Category: any mix of these.\n${PRESET_CATEGORIES.map((c) => `- ${c.label}: ${c.description}`).join("\n")}`
      : `Category: ${categoryLabel(input.category)}. ${CATEGORIES.find((c) => c.value === input.category)?.description ?? ""}${
          direction ? "\nThe category sets the tone only; the producer's premise decides the situation." : "\nFind everyday situations within this category; it is a source of situations, not a reason to get technical or extreme."
        }`;
  return {
    system: `${CONCEPT_DEVELOPER}

${TRUTHFULNESS}`,
    user: `Pitch exactly ${input.count} concepts.

${premise}${brief}
${starring}
For each concept, also sketch how one episode would actually go (beatSketch): a strong idea is one that becomes a complete story with believable cause and effect and a satisfying payoff in about a minute, not just an exciting first line.
Write each premise the way you'd say it out loud in one breath ("Kenny wakes up and everyone in the world is gone"). Big and simple beats detailed: no clock times, deadlines, notices, routes or official procedures.
${direction ? "Each concept must open differently (a different first moment or first problem)." : "Each concept must have a different central situation."}
Do not repeat ${direction ? "the opening" : "the central situation"} of any existing story (reusing a familiar setting is fine):
${input.avoidTitles.length ? input.avoidTitles.map((t) => `- ${t}`).join("\n") : "- (none yet)"}`,
  };
}

export function evaluationPrompt(input: { concepts: { title: string; premise: string; logline: string; seriesPotential: string; dramaticQuestion?: string; beatSketch?: string }[]; existingTitles: string[]; premise?: string | null }) {
  return {
    system: `You are a demanding story editor for short-form vertical video. You score concepts consistently on a 1–10 integer scale per criterion, where 5 is an average pitch and 9–10 is rare.
These are editorial heuristics, not predictions of view counts.

Criteria:
${criteriaGuide()}

The audience is everyday adults scrolling short-form video, not experts. Favor clear, familiar, relatable situations over clever, unusual or technical ones.
- relatability, curiosity, hookStrength and audienceAppeal: high only if an ordinary person would understand the idea within two seconds, could picture themselves in it, and would want to know what happens next.
- A concept that cannot be explained to a friend in one plain sentence, needs world-building or specialist knowledge, has manufactured stakes, or rests on a forced twist ("the real danger isn't X, it's Y") scores at most 4 on curiosity, hookStrength and audienceAppeal.
- A big, simple premise ("everyone in the world vanished overnight") is easy to understand in one sentence; it is not world-building. Penalise detail and logistics (deadlines, notices, procedures), not scale.
- episodeFeasibility: can this become a coherent, satisfying 45–90 second episode? Judge the episode sketch: a clear dramatic question, a believable chain of cause and effect, character choices that make sense, a payoff that doesn't rely on luck or conveniences, and a plot small enough for the length. A thrilling premise with no workable episode scores at most 4; a slightly quieter idea that makes a great episode beats it.
- seriesPotential: a credible natural continuation scores well; two strong episodes beat six stretched ones. Do not reward convoluted plots.
For originality, compare against the producer's existing stories: penalise only repeating the same central situation, not reusing a familiar setting (lost luggage and a missed connection are different stories).
Give one honest sentence of rationale per score. Evaluate every concept, using its index.`,
    user: `${
      input.premise
        ? `The producer's premise, which every concept must keep exactly:\n${input.premise}\nA concept that shrinks it into something smaller, realistic or explained away (e.g. an evacuation instead of an empty world) scores at most 3 on every criterion.\n\n`
        : ""
    }Existing stories:
${input.existingTitles.length ? input.existingTitles.map((t) => `- ${t}`).join("\n") : "- (none)"}

Concepts to evaluate:
${input.concepts
  .map(
    (c, i) => `[${i}] ${c.title}
Premise: ${c.premise}
Logline: ${c.logline}${c.dramaticQuestion ? `\nDramatic question: ${c.dramaticQuestion}` : ""}${c.beatSketch ? `\nEpisode sketch: ${c.beatSketch}` : ""}
Series potential: ${c.seriesPotential}`,
  )
  .join("\n\n")}`,
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
${
  // Older bibles recorded facts; kept in context so continuations don't contradict them.
  bible.establishedFacts.length ? `Established story facts:\n${bible.establishedFacts.map((f) => `- ${f.statement}`).join("\n")}\n` : ""
}Already revealed (do not re-reveal as new):
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
  partNumber: number;
  durationSec: number;
  wordsPerSecond: number;
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

/** The per-episode material shared by the outline and writing calls. */
export function episodeContext(input: WriterInput): string {
  const hero = input.narrator?.name ?? "the main character";
  const isContinuation = input.partNumber > 1;
  return `Story ID: ${input.storyId}
Series title: ${input.title}
Premise: ${input.premise}
Part: ${input.partNumber}
${input.narrator ? `\n${narratorBlock(input.narrator)}\n` : ""}${input.direction ? `Producer direction: ${input.direction}\n` : ""}
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

This is Part ${input.partNumber}. It must:
- Pick up directly from where Part ${input.partNumber - 1} ended, with a one-line re-orientation inside the opening, not a recap.
- Move the situation forward with a new concrete problem and a real result.
- Not repeat already-revealed information as if new.
- End on a payoff, and set up Part ${input.partNumber + 1} only if the story naturally continues.`
    : `
This is Part 1, the opening episode. It must stand alone as a satisfying story; it may leave ${hero} facing a next problem if the story earns it.`
}`;
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

export function imageReviewPrompt(input: { scene: string; rules: string[]; expected: string[]; absent: string[] }) {
  return `You are checking an illustration for a narrated story video before it is used.
${input.scene}
${input.rules.length ? `Must be true in this shot:\n${input.rules.map((r) => `- ${r}`).join("\n")}` : ""}
Characters who should be visible: ${input.expected.join(", ") || "none named"}.${input.absent.length ? ` Must NOT appear: ${input.absent.join(", ")}.` : ""}
Fail the image (pass=false) only for a clear mistake a viewer would notice at a glance:
- readable text, letters, numbers or logos
- a character in the wrong place or situation (e.g. standing on the ground when they are stuck up high)
- a named character missing, or someone there who must not appear
- obviously the wrong time of day (bright midday when it is night)
- a different moment from the one narrated
Pass it when the moment is recognisable even if a small detail is unclear or missing; a redraw costs money and rarely fixes fine detail. Put each failing problem in styleViolations, phrased as an instruction to the illustrator.`;
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
- Has a signature colour that stands out on a mostly black-and-white drawing; the video bands use a muted version of it automatically.

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
