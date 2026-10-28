import { z } from "zod";

/** A beat outline for one episode, written before the script so the story can be judged and chosen. */
export const StoryOutlineSchema = z.object({
  logline: z.string().describe("The episode in one plain sentence."),
  trigger: z.string().describe("How the hero's own choice or personality flaw causes or worsens the trouble."),
  stakes: z.string().describe("What the hero stands to lose, and the ticking clock."),
  escalations: z.array(z.string()).describe("Three complications in order, each worse than the last and caused by what came before."),
  cleverMove: z.string().describe("The smart thing the hero does, shown through action."),
  funnyMoment: z.string().describe("One moment of humour that comes from the hero's personality."),
  endingTurn: z.string().describe("The final turn: things get worse or the hero faces a hard choice. The last line lands on it."),
  beats: z.array(z.string()).describe("Six to nine beats in time order, one short sentence each."),
});
export type StoryOutline = z.infer<typeof StoryOutlineSchema>;

export const StoryOutlinesSchema = z.object({ outlines: z.array(StoryOutlineSchema) });

const Score = z.number().int().describe("1–10, where 5 is average and 9–10 is rare.");

export const OutlinePickSchema = z.object({
  reviews: z.array(
    z.object({
      index: z.number().int(),
      stakes: Score,
      escalation: Score,
      character: Score,
      ending: Score,
      note: z.string().describe("One honest sentence."),
    }),
  ),
  chosenIndex: z.number().int(),
  improvements: z.array(z.string()).describe("Up to three concrete ways to make the chosen outline stronger when it is written."),
});

/** Editor's read of a finished script. */
export const StoryReviewSchema = z.object({
  scores: z.object({ hook: Score, stakes: Score, escalation: Score, character: Score, ending: Score, flow: Score }),
  notes: z.array(z.string()).describe("Specific fixes, quoting the lines they apply to. Empty if it is ready."),
});
export type StoryReview = z.infer<typeof StoryReviewSchema>;

/** A script ships when every score is at least this. */
export const STORY_PASS_SCORE = 7;

export function storyNeedsRevision(review: StoryReview): boolean {
  return Object.values(review.scores).some((s) => s < STORY_PASS_SCORE) && review.notes.length > 0;
}
