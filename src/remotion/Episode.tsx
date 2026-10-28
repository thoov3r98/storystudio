import React from "react";
import { AbsoluteFill, Audio, Img, interpolate, Sequence, useCurrentFrame, useVideoConfig, Easing } from "remotion";
import type { EpisodeProps } from "./schema";

const BACKGROUND = "#FAFAF7";
const CROSSFADE_FRAMES = 8;

function motionTransform(preset: string, t: number): string {
  // t: 0 → 1 over the scene. Movements are slow and subtle to suit still illustrations.
  const e = Easing.inOut(Easing.quad)(t);
  switch (preset) {
    case "slow-zoom-in":
      return `scale(${1 + 0.08 * e})`;
    case "slow-zoom-out":
      return `scale(${1.08 - 0.08 * e})`;
    case "pan-left":
      return `scale(1.08) translateX(${interpolate(e, [0, 1], [2.5, -2.5])}%)`;
    case "pan-right":
      return `scale(1.08) translateX(${interpolate(e, [0, 1], [-2.5, 2.5])}%)`;
    case "pan-up":
      return `scale(1.08) translateY(${interpolate(e, [0, 1], [2, -2])}%)`;
    default:
      return "scale(1.02)";
  }
}

const SceneImage: React.FC<{ src: string; durationInFrames: number; motionPreset: string; fadeIn: boolean }> = ({ src, durationInFrames, motionPreset, fadeIn }) => {
  const frame = useCurrentFrame();
  const t = Math.min(1, frame / Math.max(1, durationInFrames));
  const opacity = fadeIn ? interpolate(frame, [0, CROSSFADE_FRAMES], [0, 1], { extrapolateRight: "clamp" }) : 1;
  return (
    <AbsoluteFill style={{ backgroundColor: BACKGROUND, opacity }}>
      {/* Images are 2:3; they fill the width and sit in the upper part of the 9:16 frame, leaving the lower band for captions. */}
      <div style={{ position: "absolute", top: 70, left: 0, width: "100%", height: 1620, overflow: "hidden" }}>
        <Img src={src} style={{ width: "100%", height: "100%", objectFit: "cover", transform: motionTransform(motionPreset, t), transformOrigin: "50% 45%" }} />
      </div>
    </AbsoluteFill>
  );
};

const Captions: React.FC<{ captions: EpisodeProps["captions"] }> = ({ captions }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const ms = (frame / fps) * 1000;
  const active = captions.find((c, i) => ms >= c.startMs && ms < (captions[i + 1]?.startMs ?? c.endMs + 400));
  if (!active) return null;
  return (
    <AbsoluteFill style={{ justifyContent: "flex-start", alignItems: "center" }}>
      {/* Safe area: above the bottom ~20% (platform UI) and away from the right-edge action buttons. */}
      <div
        style={{
          position: "absolute",
          top: 1290,
          left: 90,
          right: 150,
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          gap: "0 18px",
          fontFamily: "Inter, 'Helvetica Neue', Arial, sans-serif",
          fontWeight: 800,
          fontSize: 76,
          lineHeight: 1.15,
          textAlign: "center",
        }}
      >
        {active.words.map((w, i) => {
          const spoken = ms >= w.startMs;
          return (
            <span
              key={i}
              style={{
                color: spoken ? "#111111" : "#9A9A96",
                backgroundColor: spoken && ms < w.endMs + 120 ? "#FFE45C" : "transparent",
                borderRadius: 12,
                padding: "0 8px",
                WebkitTextStroke: "0px",
              }}
            >
              {w.text}
            </span>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};

export const Episode: React.FC<EpisodeProps> = (props) => {
  return (
    <AbsoluteFill style={{ backgroundColor: BACKGROUND }}>
      {props.scenes.map((scene, i) => (
        <Sequence
          key={scene.sceneNumber}
          from={Math.max(0, scene.startFrame - (i === 0 ? 0 : CROSSFADE_FRAMES))}
          durationInFrames={scene.durationInFrames + (i === 0 ? 0 : CROSSFADE_FRAMES)}
          name={`Scene ${scene.sceneNumber}`}
        >
          <SceneImage src={scene.imageUrl} durationInFrames={scene.durationInFrames} motionPreset={scene.motionPreset} fadeIn={i > 0} />
        </Sequence>
      ))}
      {props.showCaptions ? <Captions captions={props.captions} /> : null}
      <Audio src={props.voiceoverUrl} volume={props.voiceVolume} />
      {props.music ? <Audio src={props.music.url} volume={props.music.volume} loop /> : null}
    </AbsoluteFill>
  );
};
