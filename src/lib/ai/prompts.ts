/*
 * Prompts shared outside the script pipeline (see process-prompts.ts for the scripts).
 */

export function imageReviewPrompt(input: { scene: string; rules: string[] }) {
  return `You are checking an illustration for a narrated How It's Made style video before it is used.
${input.scene}
${input.rules.length ? `Must be true in this shot:\n${input.rules.map((r) => `- ${r}`).join("\n")}` : ""}
Fail the image (pass=false) only for a clear mistake a viewer would notice at a glance:
- readable text, letters, numbers or logos
- something in the wrong place or state (e.g. a finished product at a step where it is still raw material)
- a different moment from the one narrated
Pass it when the moment is recognisable even if a small detail is unclear or missing; a redraw costs money and rarely fixes fine detail. Put each failing problem in styleViolations, phrased as an instruction to the illustrator.`;
}
