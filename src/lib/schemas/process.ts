import { z } from "zod";

/*
 * Process explainers ("How it's made"): the web research every part is
 * written from, and the plan that splits the real stages into videos.
 * See src/lib/process/compose.ts.
 */

export const ResearchNotesSchema = z.object({
  product: z.string(),
  overview: z.string().describe("Two or three plain sentences: what the product is made of and the process from start to finish."),
  mainRoute: z
    .string()
    .describe("The most common way the product is made today, in one plain sentence (e.g. 'from wood chips, pulped and bleached'). Scripts follow this route; other routes get a sentence at most."),
  stages: z.array(
    z.object({
      id: z.string().describe('"T1", "T2"… in factory order.'),
      name: z.string().describe("A short plain name, e.g. 'Melting and colouring the wax'."),
      steps: z.array(
        z.object({
          what: z.string().describe("What happens, in one plain sentence: what goes in, what the machine or worker does, what comes out."),
          details: z.string().describe("Concrete specifics the sources give: temperatures, speeds, quantities, times, machine names. Empty if the sources give none."),
          sources: z.array(z.string()).describe("The numbers of the sources that support this step."),
        }),
      ),
    }),
  ),
  uncertain: z.array(z.string()).describe("Points the sources disagree on or don't cover. These are never narrated as fact."),
});
export type ResearchNotes = z.infer<typeof ResearchNotesSchema>;

/** Stored on the story: the notes, the sources they came from, and when they were gathered. */
export const ResearchRecordSchema = ResearchNotesSchema.extend({
  // Research gathered before main routes were marked has none.
  mainRoute: z.string().default(""),
  sources: z.array(z.object({ n: z.string(), title: z.string(), url: z.string() })),
  researchedAt: z.string(),
});
export type ResearchRecord = z.infer<typeof ResearchRecordSchema>;

export const ProcessPlanSchema = z.object({
  parts: z.array(
    z.object({
      part: z.number().int().describe("1..P"),
      title: z.string().describe("What this video covers, e.g. 'Melting the wax'."),
      stages: z.array(z.string()).describe("The stage ids this video tells, consecutive, in factory order."),
      opening: z.string().describe("How the video opens, in one spoken line: Part 1 says what the product is and where it starts; later parts name the product and the stage they pick up from."),
      endsAt: z.string().describe("Where the video ends: the point the next stage begins, or the finished, packed product for the final part."),
    }),
  ),
});
export type ProcessPlan = z.infer<typeof ProcessPlanSchema>;

/** What a process script's version stores: the plan it was told from and which part it is. */
export const ProcessSpecSchema = z.object({ plan: ProcessPlanSchema, part: z.number().int() });
export type ProcessSpec = z.infer<typeof ProcessSpecSchema>;

const processNarrationFields = {
  title: z.string(),
  storyNarration: z.string().describe("The complete voiceover for this video, read aloud."),
  summary: z.string().describe("Two or three sentences: what this video shows."),
};

export const ProcessNarrationSchema = z.object(processNarrationFields);

export const ProcessRevisionSchema = z.object({
  ...processNarrationFields,
  changeLog: z.array(z.object({ issueId: z.string(), change: z.string() })),
});

/** Validates the plan against the research: every stage told once, in order, in the allowed number of parts. */
export function validateProcessPlan(plan: ProcessPlan, research: ResearchNotes, range: [number, number]): string[] {
  const issues: string[] = [];
  const [min, max] = range;
  const count = plan.parts.length;
  if (count < min || count > max) issues.push(`Split the process into ${min}–${max} parts (you have ${count}).`);
  const order = plan.parts.flatMap((p) => p.stages);
  const stages = research.stages.map((s) => s.id);
  if (order.join(",") !== stages.join(",")) issues.push(`parts must cover every stage exactly once, in factory order: ${stages.join(", ")}.`);
  plan.parts.forEach((p, i) => {
    if (p.part !== i + 1) issues.push(`Parts must be numbered 1..${count}; position ${i + 1} is numbered ${p.part}.`);
    if (p.stages.length === 0) issues.push(`Part ${i + 1} has no stages.`);
    if (!p.opening.trim()) issues.push(`Part ${i + 1} needs an opening line.`);
  });
  return issues;
}
