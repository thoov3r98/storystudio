import { describe, expect, it } from "vitest";
import { dedupeCandidates, similarity } from "@/lib/similarity";
import { normalizeTitle } from "@/lib/text";

const luggage = {
  title: "Where Does Your Lost Luggage Actually Go?",
  premise: "Your checked suitcase disappears after a long flight and enters a hidden network of baggage handling systems.",
  keywords: ["luggage", "airport", "baggage"],
};

describe("normalizeTitle", () => {
  it("ignores filler words, case and punctuation", () => {
    expect(normalizeTitle("Where Does Your LOST Luggage Actually Go?!")).toBe(normalizeTitle("lost luggage"));
  });
});

describe("similarity", () => {
  it("flags exact normalized title matches", () => {
    const r = similarity(luggage, { title: "Where does lost luggage go", premise: "something else", keywords: [] });
    expect(r.titleExact).toBe(true);
    expect(r.score).toBe(1);
  });

  it("scores near-duplicate premises highly", () => {
    const r = similarity(luggage, {
      title: "What Happens to Your Suitcase After You Check It?",
      premise: "After you check your suitcase at the airport it travels through hidden baggage handling systems.",
      keywords: ["suitcase", "airport", "baggage"],
    });
    expect(r.score).toBeGreaterThan(0.35);
  });

  it("scores unrelated stories low", () => {
    const r = similarity(luggage, {
      title: "What Happens If Every Traffic Light Turns Green?",
      premise: "A software fault turns every traffic signal in the city green at rush hour.",
      keywords: ["traffic", "signals", "city"],
    });
    expect(r.score).toBeLessThan(0.2);
  });
});

describe("dedupeCandidates", () => {
  it("removes duplicates against the library and within the batch", () => {
    const candidates = [
      { ...luggage, title: "Where Does Lost Luggage Go?" },
      { title: "When Your City Runs Out of Water", premise: "Taps run dry across the city.", keywords: ["water"] },
      { title: "When Your City Runs Out Of Water", premise: "Every tap in the city stops.", keywords: ["water"] },
    ];
    const { unique, duplicates } = dedupeCandidates(candidates, [luggage]);
    expect(unique.map((u) => u.title)).toEqual(["When Your City Runs Out of Water"]);
    expect(duplicates).toHaveLength(2);
  });
});
