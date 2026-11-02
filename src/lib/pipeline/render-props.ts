import { type ImageShape, VIDEO } from "@/lib/constants";
import { msToFrames, type EpisodeTiming } from "@/lib/timing";
import type { EpisodeProps } from "@/remotion/schema";

/** Framings a shot cycles through at its cuts: the whole picture, a close-up on the subject, then in between. */
const FRAMINGS = ["wide", "close", "medium"] as const;

/**
 * Where a shot cuts to its next framing (ms): at caption breaks, each framing held at least
 * VIDEO.minFramingMs, three framings at most. Still pictures change every two or three seconds.
 */
export function framingCuts(startMs: number, endMs: number, captionStarts: number[]): number[] {
  const cuts: number[] = [];
  let last = startMs;
  for (const t of captionStarts) {
    if (cuts.length === FRAMINGS.length - 1) break;
    if (t - last >= VIDEO.minFramingMs && endMs - t >= VIDEO.minFramingMs) {
      cuts.push(t);
      last = t;
    }
  }
  return cuts;
}

/** How long the on-screen hook holds (ms): while its spoken line plays, within VIDEO.hookTextMs's bounds. */
export function hookDurationMs(timing: Pick<EpisodeTiming, "words">, spokenWords: number | null | undefined): number {
  const { min, max, fallback } = VIDEO.hookTextMs;
  const last = spokenWords ? timing.words[Math.min(spokenWords, timing.words.length) - 1] : undefined;
  return last ? Math.min(max, Math.max(min, last.endMs + 250)) : fallback;
}

/** Pure: converts stored timing + asset URLs into Remotion input props. */
export function buildEpisodeProps(input: {
  scenes: { sceneNumber: number; imageUrl: string; motionPreset: string; stepLabel?: string; sound?: { url: string; loop: boolean } | null }[];
  timing: EpisodeTiming;
  voiceoverUrl: string;
  voiceVolume: number;
  music: { url: string; volume: number } | null;
  sfxVolume?: number;
  /** Big on-screen text over the opening seconds, for viewers with the sound off. "*word*" is highlighted. */
  hookText?: string | null;
  /** How many spoken words the on-screen hook stands for; it holds until they have been said. */
  hookSpokenWords?: number | null;
  showCaptions?: boolean;
  /** Narration playback rate; stored timing is for 1×, so it is compressed to match. */
  narrationSpeed?: number;
  /** Series title, part label and band colour. Omitted → legacy full-frame layout. */
  bands?: { seriesTitle: string; partLabel: string; accentColor: string } | null;
  /** The version's art: square art gets the square layout, landscape art the bands layout. */
  imageShape?: ImageShape;
}): EpisodeProps {
  const fps = VIDEO.fps;
  const speed = input.narrationSpeed ?? 1;
  // Narration time is compressed; the silent tail after the narration keeps its length.
  const speechEndMs = Math.max(0, input.timing.totalDurationMs - VIDEO.tailMs);
  const at = (ms: number) => (ms <= speechEndMs ? ms / speed : speechEndMs / speed + (ms - speechEndMs));
  const durationInFrames = Math.max(1, msToFrames(at(input.timing.totalDurationMs), fps));
  const captionStarts = input.timing.captions.map((c) => c.startMs);
  const scenes = input.scenes.map((scene, i) => {
    const t = input.timing.scenes.find((s) => s.sceneNumber === scene.sceneNumber);
    if (!t) throw new Error(`No timing for scene ${scene.sceneNumber}. Re-synchronise the narration.`);
    const startFrame = msToFrames(at(t.startMs), fps);
    const endFrame = Math.min(durationInFrames, msToFrames(at(t.endMs), fps));
    const cuts = framingCuts(t.startMs, t.endMs, captionStarts);
    return {
      sceneNumber: scene.sceneNumber,
      imageUrl: scene.imageUrl,
      motionPreset: scene.motionPreset,
      startFrame,
      durationInFrames: Math.max(1, endFrame - startFrame),
      sound: scene.sound ?? null,
      stepLabel: scene.stepLabel?.trim() ?? "",
      framings: [0, ...cuts.map((c) => msToFrames(at(c), fps) - startFrame)].map((fromFrame, k) => ({ fromFrame, framing: FRAMINGS[k] })),
      // Medium framings lean left and right on alternate shots.
      side: i % 2 === 0 ? ("left" as const) : ("right" as const),
    };
  });
  const hookText = input.hookText?.trim() || "";
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
    hookText,
    hookFrames: hookText ? msToFrames(at(hookDurationMs(input.timing, input.hookSpokenWords)), fps) : 0,
    scenes,
    captions: input.timing.captions.map((c) => ({
      ...c,
      startMs: at(c.startMs),
      endMs: at(c.endMs),
      words: c.words.map((w) => ({ ...w, startMs: at(w.startMs), endMs: at(w.endMs) })),
    })),
    showCaptions: input.showCaptions ?? true,
    layout: input.bands ? (input.imageShape === "landscape" ? "bands" : "square") : "full",
    seriesTitle: input.bands?.seriesTitle ?? "",
    partLabel: input.bands?.partLabel ?? "",
    accentColor: input.bands?.accentColor ?? "#4A5D6B",
  };
}
