import { describe, expect, it } from "vitest";
import { computeStaleness, planRegeneration } from "@/lib/invalidation";

describe("planRegeneration", () => {
  it("image changes only replace that image and re-render", () => {
    const plan = planRegeneration({ kind: "scene-image", sceneNumber: 4 });
    expect(plan).toEqual({ forkVersion: false, regenerate: ["scene-images", "render"], imageScenes: [4] });
  });

  it("script changes fork a version and invalidate voiceover, timing and render", () => {
    const plan = planRegeneration({ kind: "script" });
    expect(plan.forkVersion).toBe(true);
    expect(plan.regenerate).toEqual(expect.arrayContaining(["voiceover", "timing", "render"]));
  });

  it("hook swaps keep images", () => {
    expect(planRegeneration({ kind: "hook", hookText: "x" }).imageScenes).toBe("none");
  });

  it("scene narration changes only redraw when the visual changes", () => {
    expect(planRegeneration({ kind: "scene-narration", sceneNumber: 2, imagePromptChanged: false }).imageScenes).toBe("none");
    expect(planRegeneration({ kind: "scene-narration", sceneNumber: 2, imagePromptChanged: true }).imageScenes).toEqual([2]);
  });

  it("voiceover changes invalidate timing and render but not images", () => {
    const plan = planRegeneration({ kind: "voiceover" });
    expect(plan.regenerate).toEqual(["voiceover", "timing", "render"]);
  });
});

describe("computeStaleness", () => {
  const scenes = [
    { sceneNumber: 1, currentImageId: "a" },
    { sceneNumber: 2, currentImageId: "b" },
  ];

  it("is ready when every input exists", () => {
    const s = computeStaleness({ scenes, voiceoverId: "v1", hasTiming: true, latestSucceededRender: null });
    expect(s.readyToRender).toBe(true);
    expect(s.renderMissing).toBe(true);
  });

  it("detects a render made from an older image", () => {
    const s = computeStaleness({
      scenes,
      voiceoverId: "v1",
      hasTiming: true,
      latestSucceededRender: { inputs: { voiceoverId: "v1", imageIds: { "1": "a", "2": "OLD" } } },
    });
    expect(s.renderOutdated).toBe(true);
  });

  it("detects a render made from an older voiceover", () => {
    const s = computeStaleness({
      scenes,
      voiceoverId: "v2",
      hasTiming: true,
      latestSucceededRender: { inputs: { voiceoverId: "v1", imageIds: { "1": "a", "2": "b" } } },
    });
    expect(s.renderOutdated).toBe(true);
  });

  it("reports missing inputs", () => {
    const s = computeStaleness({ scenes: [{ sceneNumber: 1, currentImageId: null }], voiceoverId: null, hasTiming: false, latestSucceededRender: null });
    expect(s).toMatchObject({ missingImages: [1], voiceoverMissing: true, timingMissing: true, readyToRender: false });
  });
});
