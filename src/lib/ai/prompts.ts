/*
 * Prompts shared outside the script pipeline (see process-prompts.ts for the scripts).
 */

export function imageReviewPrompt(input: { scene: string; rules: string[] }) {
  return `You are checking an illustration for a narrated explainer video before it is used.
${input.scene}
${input.rules.length ? `Must be true in this shot:\n${input.rules.map((r) => `- ${r}`).join("\n")}` : ""}
Fail the image (pass=false) only for a clear mistake a viewer would notice at a glance:
- readable text, letters, numbers or logos
- more than one picture: split into panels, stacked views, insets or a comic layout, or the same scene drawn twice
- something in the wrong place or state (e.g. a finished product at a step where it is still raw material, or the subject outside the body when the narration has it inside)
- a different moment from the one narrated
Pass it when the moment is recognisable even if a small detail is unclear or missing; a redraw costs money and rarely fixes fine detail. Put each failing problem in styleViolations, phrased as an instruction to the illustrator.
Also give focus: the centre of the main action (the machine part at work, the material changing, the subject the video follows), as x and y fractions of the image's width and height from its top left corner, e.g. {"x": 0.5, "y": 0.5} for the middle. The video slowly moves the camera toward it.`;
}
