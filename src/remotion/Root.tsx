import React from "react";
import { Composition, type CalculateMetadataFunction } from "remotion";
import { Episode } from "./Episode";
import { type EpisodeProps, EpisodePropsSchema } from "./schema";

const calculateMetadata: CalculateMetadataFunction<EpisodeProps> = ({ props }) => ({
  durationInFrames: props.durationInFrames,
  fps: props.fps,
  width: props.width,
  height: props.height,
});

const sample: EpisodeProps = {
  fps: 30,
  width: 1080,
  height: 1920,
  durationInFrames: 150,
  voiceoverUrl: "https://example.com/voiceover.mp3",
  voiceVolume: 1,
  voicePlaybackRate: 1,
  music: null,
  sfxVolume: 0.3,
  hookText: "It starts as a liquid",
  hookFrames: 78,
  scenes: [],
  captions: [],
  showCaptions: true,
  layout: "bands",
  seriesTitle: "Stranded on the Highway",
  partLabel: "Part 1",
  accentColor: "#4A5D6B",
};

export const RemotionRoot: React.FC = () => (
  <Composition
    id="InvisibleWorldEpisode"
    component={Episode}
    schema={EpisodePropsSchema}
    defaultProps={sample}
    calculateMetadata={calculateMetadata}
    durationInFrames={sample.durationInFrames}
    fps={30}
    width={1080}
    height={1920}
  />
);
