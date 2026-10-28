import { VIDEO } from "@/lib/constants";
import { msToFrames, type EpisodeTiming } from "@/lib/timing";
import type { EpisodeProps } from "@/remotion/schema";

/** Pure: converts stored timing + asset URLs into Remotion input props. */
export function buildEpisodeProps(input: {
  scenes: { sceneNumber: number; imageUrl: string; motionPreset: string }[];
  timing: EpisodeTiming;
  voiceoverUrl: string;
  voiceVolume: number;
  music: { url: string; volume: number } | null;
  showCaptions?: boolean;
}): EpisodeProps {
  const fps = VIDEO.fps;
  const durationInFrames = Math.max(1, msToFrames(input.timing.totalDurationMs, fps));
  const scenes = input.scenes.map((scene) => {
    const t = input.timing.scenes.find((s) => s.sceneNumber === scene.sceneNumber);
    if (!t) throw new Error(`No timing for scene ${scene.sceneNumber}. Re-synchronise the narration.`);
    const startFrame = msToFrames(t.startMs, fps);
    const endFrame = Math.min(durationInFrames, msToFrames(t.endMs, fps));
    return { sceneNumber: scene.sceneNumber, imageUrl: scene.imageUrl, motionPreset: scene.motionPreset, startFrame, durationInFrames: Math.max(1, endFrame - startFrame) };
  });
  return {
    fps,
    width: VIDEO.width,
    height: VIDEO.height,
    durationInFrames,
    voiceoverUrl: input.voiceoverUrl,
    voiceVolume: input.voiceVolume,
    music: input.music,
    scenes,
    captions: input.timing.captions,
    showCaptions: input.showCaptions ?? true,
  };
}
