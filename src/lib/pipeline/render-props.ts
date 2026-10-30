import { VIDEO } from "@/lib/constants";
import { msToFrames, type EpisodeTiming } from "@/lib/timing";
import type { EpisodeProps } from "@/remotion/schema";

/** Pure: converts stored timing + asset URLs into Remotion input props. */
export function buildEpisodeProps(input: {
  scenes: { sceneNumber: number; imageUrl: string; motionPreset: string; sound?: { url: string; loop: boolean } | null }[];
  timing: EpisodeTiming;
  voiceoverUrl: string;
  voiceVolume: number;
  music: { url: string; volume: number } | null;
  sfxVolume?: number;
  /** Big on-screen text over the opening seconds, for viewers with the sound off. */
  hookText?: string | null;
  showCaptions?: boolean;
  /** Narration playback rate; stored timing is for 1×, so it is compressed to match. */
  narrationSpeed?: number;
  /** Bands layout: series title, part label and band colour. Omitted → legacy full-frame layout. */
  bands?: { seriesTitle: string; partLabel: string; accentColor: string } | null;
}): EpisodeProps {
  const fps = VIDEO.fps;
  const speed = input.narrationSpeed ?? 1;
  // Narration time is compressed; the silent tail after the narration keeps its length.
  const speechEndMs = Math.max(0, input.timing.totalDurationMs - VIDEO.tailMs);
  const at = (ms: number) => (ms <= speechEndMs ? ms / speed : speechEndMs / speed + (ms - speechEndMs));
  const durationInFrames = Math.max(1, msToFrames(at(input.timing.totalDurationMs), fps));
  const scenes = input.scenes.map((scene) => {
    const t = input.timing.scenes.find((s) => s.sceneNumber === scene.sceneNumber);
    if (!t) throw new Error(`No timing for scene ${scene.sceneNumber}. Re-synchronise the narration.`);
    const startFrame = msToFrames(at(t.startMs), fps);
    const endFrame = Math.min(durationInFrames, msToFrames(at(t.endMs), fps));
    return { sceneNumber: scene.sceneNumber, imageUrl: scene.imageUrl, motionPreset: scene.motionPreset, startFrame, durationInFrames: Math.max(1, endFrame - startFrame), sound: scene.sound ?? null };
  });
  return {
    fps,
    width: VIDEO.width,
    height: VIDEO.height,
    durationInFrames,
    voiceoverUrl: input.voiceoverUrl,
    voiceVolume: input.voiceVolume,
    voicePlaybackRate: speed,
    music: input.music,
    sfxVolume: input.sfxVolume ?? 0,
    hookText: input.hookText?.trim() || "",
    hookFrames: msToFrames(VIDEO.hookTextMs, fps),
    scenes,
    captions: input.timing.captions.map((c) => ({
      ...c,
      startMs: at(c.startMs),
      endMs: at(c.endMs),
      words: c.words.map((w) => ({ ...w, startMs: at(w.startMs), endMs: at(w.endMs) })),
    })),
    showCaptions: input.showCaptions ?? true,
    layout: input.bands ? "bands" : "full",
    seriesTitle: input.bands?.seriesTitle ?? "",
    partLabel: input.bands?.partLabel ?? "",
    accentColor: input.bands?.accentColor ?? "#4A5D6B",
  };
}
