/*
 * Fixed premises for `pnpm story-eval generate`: one per archetype, plus the
 * producer's own apocalypse example. Keep them stable so runs compare.
 */
import type { NarratorProfile } from "@/lib/ai/prompts";
import type { StorySeed } from "@/lib/ai/story-prompts";

const kenny: NarratorProfile = {
  name: "Kenny",
  perspective: "THIRD_PERSON",
  tagline: "A night-shift warehouse worker who notices everything",
  personality: "Quiet, observant, stubborn, dry sense of humour under pressure.",
  backstory: "Works nights at a warehouse; lives alone in a small flat above a laundrette.",
  speakingStyle: "Short, dry sentences.",
};

export const BENCH_PREMISES: { id: string; title: string; premise: string; narrator?: NarratorProfile; seed?: StorySeed }[] = [
  { id: "empty-world", title: "Nobody Left", premise: "Kenny wakes up and there is nobody left in the world.", narrator: kenny, seed: { archetype: "speculative" } },
  { id: "chairlift", title: "Stuck on the Last Chairlift", premise: "The chairlift stops with one rider left on it as the ski hill closes for the night.", seed: { archetype: "survival" } },
  { id: "moved-car", title: "The Car Keeps Moving", premise: "Every morning your car is parked slightly differently from how you left it.", seed: { archetype: "mystery" } },
  { id: "wrong-text", title: "Sent to the Wrong Person", premise: "You send a text complaining about your boss to your boss.", seed: { archetype: "comedy" } },
  { id: "neighbour-light", title: "The Light Next Door", premise: "The house next door has been empty for a year, but every night at 2am a light turns on.", seed: { archetype: "suspense" } },
  { id: "missed-calls", title: "Forty-Seven Missed Calls", premise: "You wake up to 47 missed calls, all from your own phone number.", narrator: kenny },
];
