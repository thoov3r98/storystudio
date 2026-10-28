import { z } from "zod";

/** What the model returns when designing a recurring series character. */
export const CharacterProfileSchema = z.object({
  name: z.string().describe("Short, memorable name the narration can use naturally, e.g. 'Big Dave'."),
  tagline: z.string().describe("One line a viewer would use to describe them, e.g. 'An ex-trucker who keeps ending up stranded'."),
  personality: z.string().describe("Three or four traits that drive their choices and humour, in two sentences."),
  backstory: z.string().describe("Two or three sentences: everyday life and what makes them handy (or not) in a pinch. No tragic melodrama."),
  speakingStyle: z.string().describe("How they talk when narrating: rhythm, typical phrases, attitude. Two sentences."),
  visualDescription: z
    .string()
    .describe("How to draw them as a bold stick figure: build, head/hair, clothing, one signature colour item, and one recognisable prop. One or two sentences."),
  signatureColor: z.string().describe("Hex colour of their signature item, e.g. '#E0362C'. Saturated and readable behind white text."),
});

export type CharacterProfile = z.infer<typeof CharacterProfileSchema>;

export const CharacterEditSchema = CharacterProfileSchema.extend({
  name: z.string().trim().min(1).max(60),
  signatureColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a hex colour like #E0362C"),
  perspective: z.enum(["FIRST_PERSON", "THIRD_PERSON"]),
  voiceId: z.string().nullable(),
});
