import { describe, expect, it } from "vitest";
import { validateDraft } from "@/lib/pipeline/writing";
import { onScreenHookIssues } from "@/lib/process/script";
import type { EpisodeDraft } from "@/lib/schemas/episode";
import { estimateEpisodeCost, estimateIdeationCost } from "@/lib/costs/estimate";
import { DEFAULT_PRICING, textCost } from "@/lib/costs/pricing";
import { countWords, estimateSpokenDuration } from "@/lib/text";
import { buildEpisodeProps } from "@/lib/pipeline/render-props";
import { buildImagePrompt } from "@/lib/providers/images";

function draft(sceneWords: number, scenes: number, hook = "You land after ten hours."): EpisodeDraft {
  const filler = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");
  const narrations = Array.from({ length: scenes }, (_, i) => (i === 0 ? `${hook} ${filler(sceneWords - 5)}` : `${filler(sceneWords)}.`));
  return {
    title: "T",
    storyNarration: narrations.join(" "),
    selectedHook: hook,
    summary: "s",
    visualState: { setting: "s", timeAndLight: "t", weather: "w", heroSituation: "h", heroLook: "l", rules: [] },
    scenes: Array.from({ length: scenes }, (_, i) => ({
      sceneNumber: i + 1,
      narration: narrations[i],
      imagePrompt: "p",
      composition: "c",
      continuity: "",
      characters: [],
      objects: [],
      motionPreset: "still",
      soundEffect: "none",
    })),
  };
}

describe("validateDraft", () => {
  const opts = { durationSec: 75, wordsPerSecond: 2.3 };

  it("accepts a well-formed 75s draft", () => {
    expect(validateDraft(draft(14, 12), opts)).toEqual([]);
  });

  it("rejects too few scenes and too few words", () => {
    const issues = validateDraft(draft(5, 4), opts);
    expect(issues.join(" ")).toMatch(/10–15 scenes/);
    expect(issues.join(" ")).toMatch(/words/);
  });

  it("requires the scenes to be an exact cut of the story narration", () => {
    const d = draft(14, 12);
    d.scenes[3].narration = "A rewritten line that is not in the story.";
    expect(validateDraft(d, opts).join(" ")).toMatch(/word for word.*diverge/);
  });

  it("requires selectedHook to be the story's opening", () => {
    const d = draft(14, 12);
    d.selectedHook = "A different opening line entirely.";
    expect(validateDraft(d, opts).join(" ")).toMatch(/opening line/);
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

  it("pitching costs far less than writing and making a video", () => {
    const pitches = estimateIdeationCost(DEFAULT_PRICING, models, "STANDARD");
    const episode = estimateEpisodeCost(DEFAULT_PRICING, models, { durationSec: 75, quality: "STANDARD" });
    expect(pitches.total).toBeGreaterThan(0);
    expect(episode.total).toBeGreaterThan(pitches.total * 5);
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

  it("carries each shot's sound, the effects volume and the on-screen hook", () => {
    const props = buildEpisodeProps({
      scenes: [
        { sceneNumber: 1, imageUrl: "https://x.test/1.png", motionPreset: "still", sound: { url: "https://x.test/press.mp3", loop: false } },
        { sceneNumber: 2, imageUrl: "https://x.test/2.png", motionPreset: "pan-left" },
      ],
      timing: { audioDurationMs: 4000, speechEndMs: 3900, totalDurationMs: 4900, scenes: [{ sceneNumber: 1, startMs: 0, endMs: 2100 }, { sceneNumber: 2, startMs: 2100, endMs: 4900 }], words: [], captions: [] },
      voiceoverUrl: "https://x.test/vo.mp3",
      voiceVolume: 1,
      music: null,
      sfxVolume: 0.3,
      hookText: "  It starts as a liquid ",
    });
    expect(props.scenes.map((s) => s.sound)).toEqual([{ url: "https://x.test/press.mp3", loop: false }, null]);
    expect(props).toMatchObject({ sfxVolume: 0.3, hookText: "It starts as a liquid", hookFrames: 78 });
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
  it("combines global style, safe area, key objects and a no-text rule", () => {
    const prompt = buildImagePrompt({
      styleKey: "stick-figure",
      scene: { imagePrompt: "Hot wax pouring into a crayon mould", composition: "close-up", objects: ["mould"] },
      hasReference: true,
    });
    expect(prompt).toMatch(/stick-figure/);
    expect(prompt).toMatch(/Landscape 3:2/);
    expect(prompt).toMatch(/KEY OBJECTS: mould/);
    expect(prompt).toMatch(/no text/i);
    expect(prompt).toMatch(/reference image/);
  });
});

describe("on-screen hook", () => {
  const narration = "Wax is heated to 80 degrees. Then it is poured into moulds.";

  it("accepts a short statement from the narration", () => {
    expect(onScreenHookIssues("It starts as wax", narration)).toEqual([]);
    expect(onScreenHookIssues("Heated to 80 degrees", narration)).toEqual([]);
  });

  it("rejects long lines, questions and numbers the narration doesn't say", () => {
    expect(onScreenHookIssues("Wax is heated until it is completely runny", narration)[0]).toMatch(/3–6 words/);
    expect(onScreenHookIssues("Ever seen wax melt?", narration)[0]).toMatch(/not a question/);
    expect(onScreenHookIssues("Heated to 120 degrees", narration)[0]).toMatch(/says 120/);
  });
});
