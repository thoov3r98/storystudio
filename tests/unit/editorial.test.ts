import { describe, expect, it } from "vitest";
import { validateDraft } from "@/lib/pipeline/writing";
import { onScreenHookIssues } from "@/lib/process/script";
import type { EpisodeDraft } from "@/lib/schemas/episode";
import { estimateEpisodeCost, estimateIdeationCost } from "@/lib/costs/estimate";
import { DEFAULT_PRICING, textCost } from "@/lib/costs/pricing";
import { countWords, estimateSpokenDuration } from "@/lib/text";
import { buildEpisodeProps, framingCuts, hookDurationMs } from "@/lib/pipeline/render-props";
import { postCopyIssues } from "@/lib/pipeline/post";
import { hookWords } from "@/remotion/Episode";
import { processNarrationPrompt, processAuditPrompt } from "@/lib/ai/process-prompts";
import { buildImagePrompt } from "@/lib/providers/images";
import { openingStageIds, part1MustReach, validateProcessPlan } from "@/lib/schemas/process";

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
      stepLabel: "Melting the wax",
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
      shape: "landscape",
    });
    expect(prompt).toMatch(/stick-figure/);
    expect(prompt).toMatch(/Landscape 3:2/);
    expect(buildImagePrompt({ styleKey: "object-focus", scene: { imagePrompt: "x", composition: "close-up", objects: [] }, hasReference: false })).toMatch(/square picture[\s\S]*fill most of the frame|fill most of the frame[\s\S]*square picture/);
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

  it("allows one highlighted phrase, and a question only with the looser opening", () => {
    expect(onScreenHookIssues("Crayons start as *hot liquid*", narration)).toEqual([]);
    expect(onScreenHookIssues("Crayons *start* as *hot*", narration)[0]).toMatch(/single pair of asterisks/);
    expect(onScreenHookIssues("Ever seen wax melt?", narration, { allowQuestion: true })).toEqual([]);
  });

  it("pops the highlighted phrase in as one piece", () => {
    expect(hookWords("Crayons start as *hot liquid*")).toEqual([
      { text: "Crayons", highlight: false },
      { text: "start", highlight: false },
      { text: "as", highlight: false },
      { text: "hot liquid", highlight: true },
    ]);
  });

  it("holds while its spoken line plays, within bounds", () => {
    const words = Array.from({ length: 10 }, (_, i) => ({ text: "w", startMs: i * 400, endMs: i * 400 + 350, charStart: 0, charEnd: 0 }));
    expect(hookDurationMs({ words }, 8)).toBe(2800 + 350 + 250);
    expect(hookDurationMs({ words }, 2)).toBe(2200);
    expect(hookDurationMs({ words }, 40)).toBe(3600 + 350 + 250);
    expect(hookDurationMs({ words: [] }, 5)).toBe(2600);
  });
});

describe("framing cuts", () => {
  it("cuts at caption breaks, each framing held at least 1.8s, three framings at most", () => {
    expect(framingCuts(0, 7000, [0, 900, 2000, 3000, 4100, 5000, 6000])).toEqual([2000, 4100]);
    expect(framingCuts(0, 3000, [0, 1500])).toEqual([]);
    expect(framingCuts(1000, 5000, [1000, 2900, 3500])).toEqual([2900]);
  });
});

describe("post text checks", () => {
  const base = { caption: "Watch wax become crayons.", hashtags: ["#howitsmade", "#crayons", "#factory"], coverSceneNumber: 2, coverText: "How crayons are made", pinnedComment: "Pigment is added at 80 degrees." };
  const opts = { sceneNumbers: [1, 2, 3], narration: "Wax is heated.", research: "Pigment is added at 80 degrees.", part: 1, parts: 4 };

  it("accepts a clean post", () => {
    expect(postCopyIssues(base, opts)).toEqual([]);
    expect(postCopyIssues({ ...base, caption: "Part 1 of 4: wax becomes crayons." }, opts)).toEqual([]);
  });

  it("rejects bad hashtags, a missing cover shot and numbers nobody said", () => {
    const issues = postCopyIssues({ ...base, hashtags: ["#How It's Made", "#crayons", "#x"], coverSceneNumber: 9, caption: "Heated to 120 degrees.", pinnedComment: "It takes 3 days." }, opts);
    expect(issues.join(" ")).toMatch(/Hashtags/);
    expect(issues.join(" ")).toMatch(/coverSceneNumber/);
    expect(issues.join(" ")).toMatch(/caption says 120/);
    expect(issues.join(" ")).toMatch(/pinned comment says 3/);
  });
});

describe("looser opening", () => {
  const research = { product: "Crayons", overview: "o", mainRoute: "", uncertain: [], stages: [{ id: "T1", name: "Melting", steps: [{ what: "Wax is melted.", details: "", sources: ["1"] }] }] };
  const plan = { parts: [{ part: 1, title: "Melting", stages: ["T1"], opening: "wax", endsAt: "liquid" }, { part: 2, title: "Moulding", stages: ["T1"], opening: "liquid", endsAt: "crayons" }] };
  const channel = (looseOpening: boolean) => ({ name: "C", format: "PROCESS_EXPLAINER" as const, looseOpening, profile: { summary: "s", subjects: "s", voice: "never you", structure: "s", avoid: [], surpriseMe: "s", examples: [] } });
  const narrate = (loose: boolean, part: number) =>
    processNarrationPrompt({ channel: channel(loose), title: "T", premise: "p", durationSec: 60, wordsPerSecond: 2.3, research, plan, part, earlier: [] }).system;

  it("lets only Part 1's opening speak to the viewer, and only when the channel turns it on", () => {
    expect(narrate(true, 1)).toContain("OPENING EXCEPTION");
    expect(narrate(true, 2)).not.toContain("OPENING EXCEPTION");
    expect(narrate(false, 1)).not.toContain("OPENING EXCEPTION");
    const audit = processAuditPrompt({ title: "T", research, plan, part: 1, narration: "n", earlier: [], looseOpening: true }).system;
    expect(audit).toContain("not a tone issue there");
  });
});

describe("Part 1 pays off its hook", () => {
  const research = { stages: ["T1", "T2", "T3", "T4", "T5", "T6"].map((id) => ({ id, name: `Stage ${id}`, steps: [] })) };
  const plan = (first: string[], rest: string[]) => ({
    parts: [
      { part: 1, title: "a", stages: first, opening: "o", endsAt: "e" },
      { part: 2, title: "b", stages: rest, opening: "o", endsAt: "e" },
    ],
  });

  it("hooks may only feature the first half of the process", () => {
    expect(openingStageIds(research)).toEqual(["T1", "T2", "T3"]);
    expect(part1MustReach(research, "T3", 2)).toBe("T3");
    expect(part1MustReach(research, "T5", 2)).toBeNull();
    expect(part1MustReach(research, null, 2)).toBeNull();
    // Too few stages left after the hook's step to fill the other parts.
    expect(part1MustReach(research, "T3", 5)).toBeNull();
  });

  it("rejects a plan whose Part 1 stops before the hook's step", () => {
    const r = research as unknown as Parameters<typeof validateProcessPlan>[1];
    expect(validateProcessPlan(plan(["T1", "T2"], ["T3", "T4", "T5", "T6"]), r, [2, 5], { part1Reaches: "T3" })).toEqual([
      expect.stringContaining("Part 1 must run through T3"),
    ]);
    expect(validateProcessPlan(plan(["T1", "T2", "T3"], ["T4", "T5", "T6"]), r, [2, 5], { part1Reaches: "T3" })).toEqual([]);
  });

  it("asks for one single picture, never panels", () => {
    const prompt = buildImagePrompt({ styleKey: "object-focus", scene: { imagePrompt: "Semolina pours", composition: "close", objects: [] }, hasReference: false, shape: "square" });
    expect(prompt).toContain("never split the image into panels");
    expect(prompt).not.toMatch(/shown in full and also cropped/);
  });
});
