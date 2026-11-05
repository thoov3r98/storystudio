/*
 * The image check's prompt (see storyboard-prompts.ts for the storyboard).
 */

export function imageReviewPrompt(input: { scene: string; rules: string[] }) {
  return `You are checking an illustration for a narrated explainer video before it is used.
${input.scene}
${input.rules.length ? `Must be true in this shot:\n${input.rules.map((r) => `- ${r}`).join("\n")}` : ""}
Fail the image (pass=false) only for a clear mistake a viewer would notice at a glance:
- readable text, letters, numbers or logos
- more than one picture: split into panels, stacked views, insets or a comic layout, or the same scene drawn twice
- something in the wrong place or state (e.g. a finished product at a step where it is still raw material, the subject outside the body when the narration has it inside, or the wrong place or people for what is narrated)
- a real, named person drawn clearly unlike their description (wrong gender, skin tone, age range or hair colour)
- an invented machine, conveyor, pipe or gear standing in for an idea the narration describes in ordinary terms
- a different moment from the one narrated
Pass it when the moment is recognisable even if a small detail is unclear or missing; a redraw costs money and rarely fixes fine detail. Put each failing problem in styleViolations, phrased as an instruction to the illustrator.
Also give focus: the centre of the main action or subject (what the narration is about at this moment), as x and y fractions of the image's width and height from its top left corner, e.g. {"x": 0.5, "y": 0.5} for the middle. The video slowly moves the camera toward it.`;
}
