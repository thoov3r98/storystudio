import React from "react";
import { AbsoluteFill, Audio, Img, interpolate, Sequence, useCurrentFrame, useVideoConfig, Easing } from "remotion";
import type { EpisodeProps } from "./schema";

const BACKGROUND = "#FAFAF7";
const CROSSFADE_FRAMES = 8;
const FONT = "Inter, 'Helvetica Neue', Arial, sans-serif";

/*
 * Frame geometry (1080×1920). Platform UI covers roughly the top 170px, the bottom
 * 330px and a strip down the right edge, so text stays clear of those.
 *
 * bands: coloured title band · 3:2 illustration (1080×720) · coloured caption band.
 * full:  legacy 2:3 portrait art filling the frame, captions over its empty lower quarter.
 */
const BANDS = { imageTop: 560, imageHeight: 720 };

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

const SceneImage: React.FC<{ src: string; durationInFrames: number; motionPreset: string; fadeIn: boolean; layout: EpisodeProps["layout"] }> = ({
  src,
  durationInFrames,
  motionPreset,
  fadeIn,
  layout,
}) => {
  const frame = useCurrentFrame();
  const t = Math.min(1, frame / Math.max(1, durationInFrames));
  const opacity = fadeIn ? interpolate(frame, [0, CROSSFADE_FRAMES], [0, 1], { extrapolateRight: "clamp" }) : 1;
  const box: React.CSSProperties =
    layout === "bands"
      ? { top: BANDS.imageTop, height: BANDS.imageHeight, backgroundColor: BACKGROUND }
      : { top: 70, height: 1620, backgroundColor: BACKGROUND };
  return (
    <AbsoluteFill style={{ opacity }}>
      <div style={{ position: "absolute", left: 0, width: "100%", overflow: "hidden", ...box }}>
        <Img src={src} style={{ width: "100%", height: "100%", objectFit: "cover", transform: motionTransform(motionPreset, t), transformOrigin: "50% 45%" }} />
      </div>
    </AbsoluteFill>
  );
};

const TitleBand: React.FC<{ title: string; partLabel: string; accentColor: string }> = ({ title, partLabel, accentColor }) => {
  // Long series names step down in size so they fit in at most three lines.
  const fontSize = title.length > 48 ? 64 : title.length > 30 ? 76 : 92;
  return (
    <div
      style={{
        position: "absolute",
        top: 190,
        left: 70,
        right: 70,
        height: BANDS.imageTop - 190 - 40,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 22,
        textAlign: "center",
        fontFamily: FONT,
      }}
    >
      {partLabel ? (
        <div style={{ backgroundColor: "#FFFFFF", color: accentColor, fontWeight: 900, fontSize: 44, letterSpacing: 3, padding: "6px 26px", borderRadius: 999 }}>
          {partLabel.toUpperCase()}
        </div>
      ) : null}
      <div style={{ color: "#FFFFFF", fontWeight: 900, fontSize, lineHeight: 1.05, textShadow: "0 4px 0 rgba(0,0,0,0.28)", textWrap: "balance" }}>{title}</div>
    </div>
  );
};

const Captions: React.FC<{ captions: EpisodeProps["captions"]; layout: EpisodeProps["layout"] }> = ({ captions, layout }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const ms = (frame / fps) * 1000;
  const active = captions.find((c, i) => ms >= c.startMs && ms < (captions[i + 1]?.startMs ?? c.endMs + 400));
  if (!active) return null;
  const onBand = layout === "bands";
  return (
    <AbsoluteFill style={{ justifyContent: "flex-start", alignItems: "center" }}>
      {/* Safe area: above the bottom ~330px (platform UI) and away from the right-edge action buttons. */}
      <div
        style={{
          position: "absolute",
          top: onBand ? BANDS.imageTop + BANDS.imageHeight + 60 : 1290,
          left: 90,
          right: 150,
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          gap: "0 18px",
          fontFamily: FONT,
          fontWeight: 800,
          fontSize: onBand ? 72 : 76,
          lineHeight: 1.15,
          textAlign: "center",
        }}
      >
        {active.words.map((w, i) => {
          const spoken = ms >= w.startMs;
          const current = spoken && ms < w.endMs + 120;
          return (
            <span
              key={i}
              style={{
                // Bands are muted and dark, so upcoming words are translucent white.
                color: current ? "#111111" : onBand ? (spoken ? "#FFFFFF" : "rgba(255,255,255,0.45)") : spoken ? "#111111" : "#9A9A96",
                backgroundColor: current ? "#FFE45C" : "transparent",
                textShadow: onBand && spoken && !current ? "0 3px 0 rgba(0,0,0,0.25)" : undefined,
                borderRadius: 12,
                padding: "0 8px",
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
  const bands = props.layout === "bands";
  return (
    <AbsoluteFill style={{ backgroundColor: bands ? props.accentColor : BACKGROUND }}>
      {props.scenes.map((scene, i) => (
        <Sequence
          key={scene.sceneNumber}
          from={Math.max(0, scene.startFrame - (i === 0 ? 0 : CROSSFADE_FRAMES))}
          durationInFrames={scene.durationInFrames + (i === 0 ? 0 : CROSSFADE_FRAMES)}
          name={`Scene ${scene.sceneNumber}`}
        >
          <SceneImage src={scene.imageUrl} durationInFrames={scene.durationInFrames} motionPreset={scene.motionPreset} fadeIn={i > 0} layout={props.layout} />
        </Sequence>
      ))}
      {bands ? <TitleBand title={props.seriesTitle} partLabel={props.partLabel} accentColor={props.accentColor} /> : null}
      {props.showCaptions ? <Captions captions={props.captions} layout={props.layout} /> : null}
      <Audio src={props.voiceoverUrl} volume={props.voiceVolume} playbackRate={props.voicePlaybackRate} />
      {props.music ? <Audio src={props.music.url} volume={props.music.volume} loop /> : null}
    </AbsoluteFill>
  );
};
