/*
 * Dependency rules between production artifacts.
 *
 *   script ──► scene narration ──► voiceover ──► timing/captions ──► render
 *        └───► scene image prompt ──► scene image ─────────────────┘
 *
 * Changing an artifact invalidates only what depends on it. Script-level
 * changes always fork a new EpisodeVersion so approved/published versions are
 * never edited in place; image and voiceover changes add rows to the current
 * version (forking first if it is locked).
 */

export type ChangeKind =
  | { kind: "script" } // whole script regenerated
  | { kind: "hook"; hookText: string } // a different opening hook selected
  | { kind: "scene-narration"; sceneNumber: number; imagePromptChanged: boolean }
  | { kind: "scene-image"; sceneNumber: number }
  | { kind: "voiceover" }
  | { kind: "render" };

export type Artifact = "script" | "scene-images" | "voiceover" | "timing" | "render";

export type RegenerationPlan = {
  /** A new EpisodeVersion is required (script content changes). */
  forkVersion: boolean;
  /** Artifacts that must be regenerated. */
  regenerate: Artifact[];
  /** Scenes whose images must be regenerated; "all" when scene structure changes. */
  imageScenes: number[] | "all" | "none";
};

export function planRegeneration(change: ChangeKind): RegenerationPlan {
  switch (change.kind) {
    case "script":
      return { forkVersion: true, regenerate: ["script", "scene-images", "voiceover", "timing", "render"], imageScenes: "all" };
    case "hook":
      // Hook swaps only rewrite scene 1's opening; downstream scenes keep their images.
      return { forkVersion: true, regenerate: ["script", "voiceover", "timing", "render"], imageScenes: "none" };
    case "scene-narration":
      return {
        forkVersion: true,
        regenerate: change.imagePromptChanged ? ["script", "scene-images", "voiceover", "timing", "render"] : ["script", "voiceover", "timing", "render"],
        imageScenes: change.imagePromptChanged ? [change.sceneNumber] : "none",
      };
    case "scene-image":
      return { forkVersion: false, regenerate: ["scene-images", "render"], imageScenes: [change.sceneNumber] };
    case "voiceover":
      return { forkVersion: false, regenerate: ["voiceover", "timing", "render"], imageScenes: "none" };
    case "render":
      return { forkVersion: false, regenerate: ["render"], imageScenes: "none" };
  }
}

export type RenderInputs = { voiceoverId: string; imageIds: Record<string, string> };

export type Staleness = {
  missingImages: number[];
  voiceoverMissing: boolean;
  timingMissing: boolean;
  renderMissing: boolean;
  /** A render exists but was made from different images or audio than the current ones. */
  renderOutdated: boolean;
  readyToRender: boolean;
};

export function computeStaleness(state: {
  scenes: { sceneNumber: number; currentImageId: string | null }[];
  voiceoverId: string | null;
  hasTiming: boolean;
  latestSucceededRender: { inputs: RenderInputs } | null;
}): Staleness {
  const missingImages = state.scenes.filter((s) => !s.currentImageId).map((s) => s.sceneNumber);
  const voiceoverMissing = !state.voiceoverId;
  const timingMissing = !state.hasTiming;
  const renderMissing = !state.latestSucceededRender;
  let renderOutdated = false;
  if (state.latestSucceededRender) {
    const inputs = state.latestSucceededRender.inputs;
    renderOutdated =
      inputs.voiceoverId !== state.voiceoverId ||
      state.scenes.some((s) => inputs.imageIds[String(s.sceneNumber)] !== s.currentImageId) ||
      Object.keys(inputs.imageIds).length !== state.scenes.length;
  }
  return {
    missingImages,
    voiceoverMissing,
    timingMissing,
    renderMissing,
    renderOutdated,
    readyToRender: missingImages.length === 0 && !voiceoverMissing && !timingMissing,
  };
}
