import { z } from "zod";

/*
 * Story bible schemas. These are sent to OpenAI as strict structured-output
 * schemas, so every property is required and "optional" values are nullable.
 */

export const CharacterSchema = z.object({
  name: z.string().describe("Stable name used across all episodes. Use a role name like 'You' or 'The baggage handler' if unnamed."),
  role: z.string(),
  description: z.string(),
  visualDescription: z.string().describe("How to draw this character as a stick figure: distinguishing props, hat, hair, posture."),
  firstAppearedPart: z.number().int(),
});

export const LocationSchema = z.object({
  name: z.string(),
  description: z.string(),
});

export const TimelineEventSchema = z.object({
  part: z.number().int(),
  order: z.number().int().describe("Order of the event within the part, starting at 1."),
  event: z.string(),
});

export const FactSchema = z.object({
  statement: z.string(),
  kind: z.enum(["real-world", "story-world"]).describe("real-world: claims about reality. story-world: things true only inside this story."),
  part: z.number().int(),
});

export const ThreadSchema = z.object({
  id: z.string().describe("Short stable slug, e.g. 'missing-tag'."),
  description: z.string(),
  introducedPart: z.number().int(),
  status: z.enum(["open", "resolved"]),
  resolvedPart: z.number().int().nullable(),
  resolution: z.string().nullable(),
});

export const RecurringVisualSchema = z.object({
  name: z.string(),
  description: z.string(),
});

export const StoryBibleSchema = z.object({
  premise: z.string(),
  tone: z.string(),
  narrativePerspective: z.string(),
  characters: z.array(CharacterSchema),
  locations: z.array(LocationSchema),
  timeline: z.array(TimelineEventSchema),
  establishedFacts: z.array(FactSchema),
  technicalFacts: z.array(FactSchema),
  mysteries: z.array(z.string()),
  unresolvedThreads: z.array(ThreadSchema),
  revealedInformation: z.array(z.string()),
  constraints: z.array(z.string()).describe("Rules future episodes must respect."),
  visualStyle: z.object({
    styleKey: z.string(),
    notes: z.string(),
    recurringVisuals: z.array(RecurringVisualSchema),
  }),
  arcSummary: z.string().describe("Compressed summary of the series so far. Kept short so long series stay cheap to continue."),
});

export type StoryBible = z.infer<typeof StoryBibleSchema>;

/** Changes an episode proposes to the canonical bible. Applied only on approval. */
export const StoryBibleUpdateSchema = z.object({
  addCharacters: z.array(CharacterSchema),
  updateCharacters: z.array(
    z.object({ name: z.string(), description: z.string().nullable(), visualDescription: z.string().nullable() }),
  ),
  addLocations: z.array(LocationSchema),
  addTimelineEvents: z.array(TimelineEventSchema),
  addMysteries: z.array(z.string()),
  openThreads: z.array(z.object({ id: z.string(), description: z.string() })),
  resolveThreads: z.array(z.object({ id: z.string(), resolution: z.string() })),
  addRevealedInformation: z.array(z.string()),
  addConstraints: z.array(z.string()),
  addRecurringVisuals: z.array(RecurringVisualSchema),
  arcSummary: z.string().describe("The full replacement arcSummary including this episode, at most ~150 words."),
});

export type StoryBibleUpdate = z.infer<typeof StoryBibleUpdateSchema>;

export function emptyBible(input: { premise: string; tone?: string; styleKey: string }): StoryBible {
  return {
    premise: input.premise,
    tone: input.tone ?? "Curious, grounded and plainly told. Second-person and conversational.",
    narrativePerspective: "Second person ('you'), present tense.",
    characters: [],
    locations: [],
    timeline: [],
    establishedFacts: [],
    technicalFacts: [],
    mysteries: [],
    unresolvedThreads: [],
    revealedInformation: [],
    constraints: [],
    visualStyle: { styleKey: input.styleKey, notes: "", recurringVisuals: [] },
    arcSummary: "",
  };
}

function upsertBy<T>(list: T[], items: T[], key: (t: T) => string): T[] {
  const out = [...list];
  for (const item of items) {
    const k = key(item).trim().toLowerCase();
    const idx = out.findIndex((x) => key(x).trim().toLowerCase() === k);
    if (idx >= 0) out[idx] = item;
    else out.push(item);
  }
  return out;
}

function uniqueStrings(list: string[], add: string[]): string[] {
  const seen = new Set(list.map((s) => s.trim().toLowerCase()));
  const out = [...list];
  for (const s of add) {
    const k = s.trim().toLowerCase();
    if (k && !seen.has(k)) {
      seen.add(k);
      out.push(s.trim());
    }
  }
  return out;
}

/** Pure merge of an approved episode's update into the bible. */
export function applyBibleUpdate(bible: StoryBible, update: StoryBibleUpdate, part: number): StoryBible {
  let characters = upsertBy(bible.characters, update.addCharacters, (c) => c.name);
  characters = characters.map((c) => {
    const change = update.updateCharacters.find((u) => u.name.trim().toLowerCase() === c.name.trim().toLowerCase());
    if (!change) return c;
    return {
      ...c,
      description: change.description ?? c.description,
      visualDescription: change.visualDescription ?? c.visualDescription,
    };
  });

  const resolved = new Map(update.resolveThreads.map((r) => [r.id, r.resolution]));
  const threads = bible.unresolvedThreads.map((t) =>
    resolved.has(t.id) ? { ...t, status: "resolved" as const, resolvedPart: part, resolution: resolved.get(t.id) ?? null } : t,
  );
  for (const open of update.openThreads) {
    if (!threads.some((t) => t.id === open.id)) {
      threads.push({ id: open.id, description: open.description, introducedPart: part, status: "open", resolvedPart: null, resolution: null });
    }
  }

  return {
    ...bible,
    characters,
    locations: upsertBy(bible.locations, update.addLocations, (l) => l.name),
    timeline: [...bible.timeline.filter((e) => e.part !== part), ...update.addTimelineEvents.map((e) => ({ ...e, part }))].sort(
      (a, b) => a.part - b.part || a.order - b.order,
    ),
    mysteries: uniqueStrings(bible.mysteries, update.addMysteries),
    unresolvedThreads: threads,
    revealedInformation: uniqueStrings(bible.revealedInformation, update.addRevealedInformation),
    constraints: uniqueStrings(bible.constraints, update.addConstraints),
    visualStyle: {
      ...bible.visualStyle,
      recurringVisuals: upsertBy(bible.visualStyle.recurringVisuals, update.addRecurringVisuals, (v) => v.name),
    },
    arcSummary: update.arcSummary.trim() || bible.arcSummary,
  };
}

export function openThreads(bible: StoryBible) {
  return bible.unresolvedThreads.filter((t) => t.status === "open");
}
