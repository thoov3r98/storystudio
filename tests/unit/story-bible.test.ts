import { describe, expect, it } from "vitest";
import { applyBibleUpdate, emptyBible, StoryBibleSchema, type StoryBibleUpdate } from "@/lib/schemas/story-bible";
import { selectContinuationContext } from "@/lib/pipeline/context";

const noChanges: StoryBibleUpdate = {
  addCharacters: [],
  updateCharacters: [],
  addLocations: [],
  addTimelineEvents: [],
  addEstablishedFacts: [],
  addTechnicalFacts: [],
  addMysteries: [],
  openThreads: [],
  resolveThreads: [],
  addRevealedInformation: [],
  addConstraints: [],
  addRecurringVisuals: [],
  arcSummary: "",
};

describe("applyBibleUpdate", () => {
  const base = emptyBible({ premise: "Lost luggage", styleKey: "stick-figure" });

  it("adds new continuity from Part 1", () => {
    const next = applyBibleUpdate(
      base,
      {
        ...noChanges,
        addCharacters: [{ name: "Maya", role: "baggage handler", description: "Night shift", visualDescription: "cap", firstAppearedPart: 1 }],
        openThreads: [{ id: "missing-tag", description: "Why was the tag reprinted?" }],
        addTimelineEvents: [{ part: 99, order: 1, event: "Bag missing" }],
        addRevealedInformation: ["Bags are scanned many times"],
        arcSummary: "A bag vanishes.",
      },
      1,
    );
    expect(StoryBibleSchema.safeParse(next).success).toBe(true);
    expect(next.characters).toHaveLength(1);
    expect(next.unresolvedThreads[0]).toMatchObject({ id: "missing-tag", status: "open", introducedPart: 1 });
    expect(next.timeline[0].part).toBe(1); // part is forced to the approved episode
    expect(next.arcSummary).toBe("A bag vanishes.");
  });

  it("resolves threads, updates characters and deduplicates reveals in Part 2", () => {
    const part1 = applyBibleUpdate(
      base,
      {
        ...noChanges,
        addCharacters: [{ name: "Maya", role: "handler", description: "Night shift", visualDescription: "cap", firstAppearedPart: 1 }],
        openThreads: [{ id: "missing-tag", description: "Why?" }],
        addRevealedInformation: ["Bags are scanned"],
        arcSummary: "One",
      },
      1,
    );
    const part2 = applyBibleUpdate(
      part1,
      {
        ...noChanges,
        updateCharacters: [{ name: "maya", description: "Now a supervisor", visualDescription: null }],
        resolveThreads: [{ id: "missing-tag", resolution: "A printer fault" }],
        addRevealedInformation: ["bags are scanned", "Tags can be reprinted"],
        arcSummary: "",
      },
      2,
    );
    expect(part2.characters[0]).toMatchObject({ description: "Now a supervisor", visualDescription: "cap" });
    expect(part2.unresolvedThreads[0]).toMatchObject({ status: "resolved", resolvedPart: 2, resolution: "A printer fault" });
    expect(part2.revealedInformation).toEqual(["Bags are scanned", "Tags can be reprinted"]);
    expect(part2.arcSummary).toBe("One"); // empty summary keeps the previous one
  });
});

describe("selectContinuationContext", () => {
  const history = Array.from({ length: 25 }, (_, i) => ({
    partNumber: i + 1,
    title: `Part ${i + 1}`,
    summary: `Summary ${i + 1}`,
    narration: `Narration ${i + 1}`,
    keyReveals: [],
    unresolvedQuestions: [],
  }));

  it("sends the latest episode in full and only recent summaries", () => {
    const ctx = selectContinuationContext(history, 10);
    expect(ctx.latestEpisode?.partNumber).toBe(25);
    expect(ctx.latestEpisode?.narration).toBe("Narration 25");
    expect(ctx.previousEpisodes.map((e) => e.partNumber)).toEqual([15, 16, 17, 18, 19, 20, 21, 22, 23, 24]);
    expect(ctx.omittedCount).toBe(14);
    expect(JSON.stringify(ctx.previousEpisodes)).not.toContain("Narration");
  });

  it("handles a story with one approved episode", () => {
    const ctx = selectContinuationContext(history.slice(0, 1));
    expect(ctx.latestEpisode?.partNumber).toBe(1);
    expect(ctx.previousEpisodes).toEqual([]);
  });
});
