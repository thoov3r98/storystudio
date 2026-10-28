import { describe, expect, it } from "vitest";
import { CRITERIA, type CriteriaScores, normalizeScores, totalScore, validateScores } from "@/lib/schemas/concept";
import { rankConcepts } from "@/lib/pipeline/ideation";
import { validateDraft } from "@/lib/pipeline/writing";
import type { EpisodeDraft } from "@/lib/schemas/episode";
import { estimateBatchCost, estimateEpisodeCost } from "@/lib/costs/estimate";
import { DEFAULT_PRICING, textCost } from "@/lib/costs/pricing";
import { countWords, estimateSpokenDuration } from "@/lib/text";
import { buildEpisodeProps } from "@/lib/pipeline/render-props";
import { buildImagePrompt } from "@/lib/providers/images";

function scores(n: number): CriteriaScores {
  return Object.fromEntries(CRITERIA.map((c) => [c.key, { score: n, rationale: "r" }])) as CriteriaScores;
}

describe("scoring", () => {
  it("computes a weighted mean on the 1–10 scale", () => {
    expect(totalScore(scores(7))).toBe(7);
  });

  it("clamps out-of-range scores and reports them", () => {
    const s = { ...scores(5), curiosity: { score: 14, rationale: "" } };
    expect(validateScores(s)).toHaveLength(1);
    expect(normalizeScores(s).curiosity.score).toBe(10);
  });

  it("ranks by total, then curiosity", () => {
    const mk = (id: string, total: number, curiosity: number) => ({
      id,
      total,
      evaluation: { conceptIndex: 0, summary: "", scores: { ...scores(5), curiosity: { score: curiosity, rationale: "" } } },
    });
    expect(rankConcepts([mk("a", 6, 5), mk("b", 7, 1), mk("c", 6, 9)]).map((x) => x.id)).toEqual(["b", "c", "a"]);
  });
});

function draft(sceneWords: number, scenes: number, hook = "You land after ten hours."): EpisodeDraft {
  const filler = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");
  return {
    title: "T",
    selectedHook: hook,
    summary: "s",
    scenes: Array.from({ length: scenes }, (_, i) => ({
      sceneNumber: i + 1,
      narration: i === 0 ? `${hook} ${filler(sceneWords - 5)}` : `${filler(sceneWords)}.`,
      visualDescription: "v",
      imagePrompt: "p",
      composition: "c",
      characters: [],
      objects: [],
      intendedDurationSec: 6,
      motionPreset: "still",
    })),
    keyReveals: [],
    establishedFacts: [],
    unresolvedQuestions: [],
    continuationOpportunities: [],
    claims: [],
    bibleUpdate: {
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
    },
  };
}

describe("validateDraft", () => {
  const opts = { durationSec: 75, wordsPerSecond: 2.3, hook: "You land after ten hours." };

  it("accepts a well-formed 75s draft", () => {
    expect(validateDraft(draft(14, 12), opts)).toEqual([]);
  });

  it("rejects too few scenes and too few words", () => {
    const issues = validateDraft(draft(5, 4), opts);
    expect(issues.join(" ")).toMatch(/10–15 scenes/);
    expect(issues.join(" ")).toMatch(/words/);
  });

  it("requires scene 1 to open with the hook", () => {
    const d = draft(14, 12);
    d.scenes[0].narration = "Something else entirely starts this episode and keeps going for a while longer.";
    expect(validateDraft(d, opts).join(" ")).toMatch(/hook verbatim/);
  });
});

describe("text metrics", () => {
  it("adds pauses for punctuation instead of using word count alone", () => {
    const plain = "one two three four five six seven eight nine ten";
    const punctuated = "One. Two. Three. Four. Five. Six. Seven. Eight. Nine. Ten.";
    expect(countWords(plain)).toBe(countWords(punctuated));
    expect(estimateSpokenDuration(punctuated)).toBeGreaterThan(estimateSpokenDuration(plain));
  });
});

describe("cost estimates", () => {
  const models = { main: "gpt-5.5", fast: "gpt-5.4-mini" };

  it("concept mode costs far less than full production", () => {
    const concept = estimateBatchCost(DEFAULT_PRICING, models, { requested: 20, durationSec: 75, quality: "STANDARD", fullProduction: false });
    const full = estimateBatchCost(DEFAULT_PRICING, models, { requested: 20, durationSec: 75, quality: "STANDARD", fullProduction: true });
    expect(concept.total).toBe(concept.ideation.total);
    expect(full.total).toBeGreaterThan(concept.total * 5);
  });

  it("premium episodes cost more than draft", () => {
    const d = estimateEpisodeCost(DEFAULT_PRICING, models, { durationSec: 75, quality: "DRAFT" });
    const p = estimateEpisodeCost(DEFAULT_PRICING, models, { durationSec: 75, quality: "PREMIUM" });
    expect(p.total).toBeGreaterThan(d.total);
  });

  it("prices cached input tokens separately", () => {
    const full = textCost(DEFAULT_PRICING, "gpt-5.5", { inputTokens: 1_000_000, outputTokens: 0 });
    const cached = textCost(DEFAULT_PRICING, "gpt-5.5", { inputTokens: 1_000_000, cachedInputTokens: 1_000_000, outputTokens: 0 });
    expect(cached).toBeLessThan(full);
  });

  it("prices dated model snapshots at their alias's rate", () => {
    const usage = { inputTokens: 1_000_000, outputTokens: 0 };
    expect(textCost(DEFAULT_PRICING, "gpt-5.4-mini-2026-03-17", usage)).toBe(textCost(DEFAULT_PRICING, "gpt-5.4-mini", usage));
    expect(textCost(DEFAULT_PRICING, "gpt-5.4-mini", usage)).toBeLessThan(textCost(DEFAULT_PRICING, "gpt-5.5", usage));
  });
});

describe("buildEpisodeProps", () => {
  it("converts real timing into frame-accurate scene sequences", () => {
    const props = buildEpisodeProps({
      scenes: [
        { sceneNumber: 1, imageUrl: "https://x.test/1.png", motionPreset: "still" },
        { sceneNumber: 2, imageUrl: "https://x.test/2.png", motionPreset: "pan-left" },
      ],
      timing: {
        audioDurationMs: 4000,
        speechEndMs: 3900,
        totalDurationMs: 4900,
        scenes: [
          { sceneNumber: 1, startMs: 0, endMs: 2100 },
          { sceneNumber: 2, startMs: 2100, endMs: 4900 },
        ],
        words: [],
        captions: [],
      },
      voiceoverUrl: "https://x.test/vo.mp3",
      voiceVolume: 1,
      music: null,
    });
    expect(props).toMatchObject({ width: 1080, height: 1920, fps: 30, durationInFrames: 147 });
    expect(props.scenes[1]).toMatchObject({ startFrame: 63, durationInFrames: 84 });
  });

  it("compresses narration timing for a speed-up but keeps the silent tail", () => {
    const props = buildEpisodeProps({
      scenes: [
        { sceneNumber: 1, imageUrl: "https://x.test/1.png", motionPreset: "still" },
        { sceneNumber: 2, imageUrl: "https://x.test/2.png", motionPreset: "pan-left" },
      ],
      timing: {
        audioDurationMs: 4000,
        speechEndMs: 3900,
        totalDurationMs: 4900, // 4000 narration + 900 tail
        scenes: [
          { sceneNumber: 1, startMs: 0, endMs: 2000 },
          { sceneNumber: 2, startMs: 2000, endMs: 4900 },
        ],
        words: [],
        captions: [{ text: "hi there", startMs: 1000, endMs: 2000, words: [{ text: "hi", startMs: 1000, endMs: 1400 }, { text: "there", startMs: 1500, endMs: 2000 }] }],
      },
      voiceoverUrl: "https://x.test/vo.mp3",
      voiceVolume: 1,
      music: null,
      narrationSpeed: 1.25,
    });
    // 4000ms / 1.25 = 3200ms of narration + 900ms tail = 4100ms = 123 frames.
    expect(props).toMatchObject({ durationInFrames: 123, voicePlaybackRate: 1.25 });
    expect(props.scenes[1]).toMatchObject({ startFrame: 48, durationInFrames: 75 });
    expect(props.captions[0].words[1]).toMatchObject({ startMs: 1200, endMs: 1600 });
  });
});

describe("buildImagePrompt", () => {
  it("combines global style, safe area, characters and a no-text rule", () => {
    const prompt = buildImagePrompt({
      styleKey: "stick-figure",
      scene: { imagePrompt: "A traveler at an empty carousel", composition: "wide shot", characters: ["You"], objects: ["carousel"] },
      characterSheet: [{ name: "You", visualDescription: "backpack and round glasses" }],
      hasReference: true,
    });
    expect(prompt).toMatch(/stick-figure/);
    expect(prompt).toMatch(/bottom quarter/);
    expect(prompt).toMatch(/backpack and round glasses/);
    expect(prompt).toMatch(/no text/i);
    expect(prompt).toMatch(/reference image/);
  });
});
