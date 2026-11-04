import { describe, expect, it } from "vitest";
import { cleanScript, cutParts, estimateParts, evenBreaks, onScreenHookIssues, recutExactly, sceneCountFor, splitIssues, splitSentences, storyboardIssues } from "@/lib/script";
import { estimateScriptCost } from "@/lib/costs/estimate";
import { DEFAULT_PRICING } from "@/lib/costs/pricing";
import type { SceneSpec } from "@/lib/schemas/episode";

const shot = (n: number, narration: string, extra: Partial<SceneSpec> = {}): SceneSpec => ({
  sceneNumber: n,
  narration,
  imagePrompt: "p",
  composition: "c",
  continuity: "",
  characters: [],
  objects: [],
  motionPreset: "slow-zoom-in",
  soundEffect: "press",
  stepLabel: "Melting the wax",
  ...extra,
});

describe("pasted scripts", () => {
  it("cleans whitespace but keeps paragraphs and every word", () => {
    expect(cleanScript("  Hello   there.\r\n\r\n\r\nNext  bit.\n")).toBe("Hello there.\n\nNext bit.");
  });

  it("splits sentences at end punctuation (with closing quotes) and paragraph breaks", () => {
    const text = 'It melts. Then it pours! Is it hot? "Very hot." Wait…\n\nA heading without a full stop\n\nThe end.';
    expect(splitSentences(text)).toEqual(["It melts.", "Then it pours!", "Is it hot?", '"Very hot."', "Wait…", "A heading without a full stop", "The end."]);
    expect(splitSentences("Dr. Smith is 2.5 m tall.")).toEqual(["Dr.", "Smith is 2.5 m tall."]);
  });

  it("cuts parts at sentence numbers and puts them back together exactly", () => {
    const s = ["A.", "B.", "C.", "D.", "E."];
    expect(cutParts(s, [3])).toEqual(["A. B.", "C. D. E."]);
    expect(cutParts(s, [2, 4])).toEqual(["A.", "B. C.", "D. E."]);
    expect(cutParts(s, []).join(" ")).toBe(s.join(" "));
  });

  it("rejects breaks that are out of order, out of range, the wrong count, or very uneven", () => {
    const s = Array.from({ length: 10 }, (_, i) => `Sentence number ${i} here.`);
    expect(splitIssues(s, [4, 7], 3)).toEqual([]);
    expect(splitIssues(s, [4], 3)[0]).toMatch(/exactly 2 breaks/);
    expect(splitIssues(s, [7, 4], 3)[0]).toMatch(/increasing/);
    expect(splitIssues(s, [1], 2)[0]).toMatch(/increasing/);
    expect(splitIssues(s, [11], 2)[0]).toMatch(/increasing/);
    expect(splitIssues(s, [2], 2)[0]).toMatch(/less than half/);
  });

  it("falls back to an even split by length", () => {
    const s = Array.from({ length: 12 }, () => "Four words in here.");
    expect(evenBreaks(s, 3)).toEqual([5, 9]);
    expect(evenBreaks(s, 1)).toEqual([]);
    expect(splitIssues(s, evenBreaks(s, 4), 4)).toEqual([]);
  });

  it("estimates length per video from the voice's pace", () => {
    const text = Array.from({ length: 30 }, () => "Five words are in here.").join(" ");
    const e = estimateParts(text, 3, 2.5);
    expect(e.words).toBe(150);
    expect(e.totalSec).toBeCloseTo(60 + 30 * 0.22, 1);
    expect(e.perPartSec).toBeCloseTo(e.totalSec / 3, 5);
  });

  it("asks for a shot every 4–7 seconds", () => {
    expect(sceneCountFor(60)).toEqual([9, 13]);
    expect(sceneCountFor(30)).toEqual([4, 7]);
    expect(sceneCountFor(3)).toEqual([1, 2]);
  });

  it("checks that the shots are the narration word for word, with valid sounds and motion", () => {
    const narration = "It melts. Then it pours into moulds.";
    const ok = [shot(1, "it melts"), shot(2, "then it pours into moulds")];
    expect(storyboardIssues(narration, ok, { format: "PROCESS_EXPLAINER", durationSec: 6 })).toEqual([]);
    const dropped = storyboardIssues(narration, [shot(1, "it melts"), shot(2, "then pours into moulds")], { format: "PROCESS_EXPLAINER", durationSec: 6 });
    expect(dropped[0]).toMatch(/word for word/);
    const wrongSound = storyboardIssues(narration, [shot(1, "it melts", { soundEffect: "heartbeat" }), shot(2, "then it pours into moulds", { motionPreset: "dive-in" })], { format: "PROCESS_EXPLAINER", durationSec: 6 });
    expect(wrongSound.join(" ")).toMatch(/dive-in is only for shot 1/);
    expect(wrongSound.join(" ")).toMatch(/soundEffect must be one of/);
  });

  it("restores the producer's punctuation and capitals at the model's cut points", () => {
    const narration = "It melts — slowly. Then, at 80°C, it pours!";
    const cut = recutExactly(narration, [shot(1, "it melts slowly"), shot(2, "then at 80 c it pours")]);
    expect(cut.map((s) => s.narration)).toEqual(["It melts — slowly.", "Then, at 80°C, it pours!"]);
  });

  it("keeps the on-screen hook short and true to the narration", () => {
    expect(onScreenHookIssues("It starts as *wax*", "Crayons start as wax.")).toEqual([]);
    expect(onScreenHookIssues("Heated to 900 degrees", "It is heated.")[0]).toMatch(/900/);
    expect(onScreenHookIssues("Is it *hot*?", "It is hot.")[0]).toMatch(/not a question/);
    expect(onScreenHookIssues("Is it *hot*?", "It is hot.", { allowQuestion: true })).toEqual([]);
  });

  it("estimates the whole script's cost, growing with words and parts", () => {
    const models = { main: "gpt-5.5", fast: "gpt-5.4-mini" };
    const one = estimateScriptCost(DEFAULT_PRICING, models, { words: 150, parts: 1, wordsPerSecond: 2.5, quality: "STANDARD" });
    const three = estimateScriptCost(DEFAULT_PRICING, models, { words: 450, parts: 3, wordsPerSecond: 2.5, quality: "STANDARD" });
    expect(one.perPartSec).toBe(60);
    expect(one.total).toBeGreaterThan(0);
    expect(three.total).toBeGreaterThan(one.total * 2.5);
    expect(three.text).toBeGreaterThan(one.text * 3); // the split, and each storyboard reads the whole script
  });
});
