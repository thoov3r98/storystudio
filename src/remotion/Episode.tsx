import React from "react";
import { AbsoluteFill, Audio, Img, interpolate, Sequence, useCurrentFrame, useVideoConfig, Easing } from "remotion";
import type { EpisodeProps } from "./schema";

const BACKGROUND = "#FAFAF7";
const CROSSFADE_FRAMES = 8;
const HIGHLIGHT = "#FFE45C";
const INK = "#111111";
const SOUND_FADE_FRAMES = 6;
const FONT = "Inter, 'Helvetica Neue', Arial, sans-serif";

/*
 * Frame geometry (1080×1920). Platform UI covers roughly the top 170px, the bottom
 * 330px and a strip down the right edge, so text stays clear of those.
 *
 * square: title band · square illustration (1080×1080) · caption band.
 * bands:  title band · 3:2 illustration (1080×720) · caption band (landscape art, before November 2026).
 * full:   legacy 2:3 portrait art filling the frame, captions over its empty lower quarter.
 */
const LAYOUTS = {
  square: { imageTop: 440, imageHeight: 1080, titleTop: 180, captionTop: 1556, captionSize: 64, close: 1.25 },
  bands: { imageTop: 560, imageHeight: 720, titleTop: 190, captionTop: 1340, captionSize: 72, close: 1.3 },
  full: { imageTop: 70, imageHeight: 1620, titleTop: 200, captionTop: 1290, captionSize: 76, close: 1.2 },
} as const;

type Scene = EpisodeProps["scenes"][number];

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

/** Hard cuts within a shot: the whole picture, a close-up on its centre, or in between and to one side. */
function framingTransform(framing: Scene["framings"][number]["framing"], side: Scene["side"], close: number): string {
  if (framing === "close") return `scale(${close})`;
  if (framing === "medium") return `scale(1.12) translateX(${side === "left" ? 3 : -3}%)`;
  return "scale(1)";
}

const SceneImage: React.FC<{ scene: Scene; offset: number; fadeIn: boolean; layout: EpisodeProps["layout"] }> = ({ scene, offset, fadeIn, layout }) => {
  const frame = useCurrentFrame();
  const own = frame - offset; // frames since the shot's own start (the crossfade starts before it)
  const t = Math.min(1, Math.max(0, own) / Math.max(1, scene.durationInFrames));
  const opacity = fadeIn ? interpolate(frame, [0, CROSSFADE_FRAMES], [0, 1], { extrapolateRight: "clamp" }) : 1;
  const geo = LAYOUTS[layout];
  const current = [...scene.framings].reverse().find((f) => own >= f.fromFrame) ?? scene.framings[0];
  return (
    <AbsoluteFill style={{ opacity }}>
      <div style={{ position: "absolute", left: 0, width: "100%", overflow: "hidden", top: geo.imageTop, height: geo.imageHeight, backgroundColor: BACKGROUND }}>
        <Img
          src={scene.imageUrl}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            transform: `${framingTransform(current?.framing ?? "wide", scene.side, geo.close)} ${motionTransform(scene.motionPreset, t)}`,
            transformOrigin: "50% 45%",
          }}
        />
      </div>
    </AbsoluteFill>
  );
};

/** "Crayons start as *hot liquid*" → words that pop in one by one; the starred phrase pops in as one highlighted piece. */
export function hookWords(text: string): { text: string; highlight: boolean }[] {
  return text.split("*").flatMap((part, i): { text: string; highlight: boolean }[] => {
    if (i % 2 === 1) return part.trim() ? [{ text: part.trim(), highlight: true }] : [];
    return part
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => ({ text: w, highlight: false }));
  });
}

const OUTLINE = `-4px -4px 0 ${INK}, 4px -4px 0 ${INK}, -4px 4px 0 ${INK}, 4px 4px 0 ${INK}, 0 8px 0 ${INK}`;

/**
 * The on-screen hook, for viewers watching with the sound off: big outlined words that pop in one
 * after another, the surprise word on yellow. Readable over the band and over the art.
 */
const HookText: React.FC<{ text: string; endFrame: number }> = ({ text, endFrame }) => {
  const frame = useCurrentFrame();
  const words = hookWords(text);
  const plain = words.map((w) => w.text).join(" ");
  const fontSize = plain.length > 28 ? 80 : plain.length > 18 ? 92 : 108;
  const out = interpolate(frame, [endFrame - 4, endFrame], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "8px 22px", fontWeight: 900, fontSize, lineHeight: 1.08, opacity: out }}>
      {words.map((w, i) => {
        const start = i * 3;
        const scale = interpolate(frame, [start, start + 6], [0.5, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.back(2.2)) });
        const opacity = interpolate(frame, [start, start + 3], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
        return (
          <span
            key={i}
            style={{
              display: "inline-block",
              transform: `scale(${scale})`,
              opacity,
              ...(w.highlight
                ? { color: INK, backgroundColor: HIGHLIGHT, padding: "0 16px", borderRadius: 16, boxShadow: `0 8px 0 ${INK}` }
                : { color: "#FFFFFF", textShadow: OUTLINE }),
            }}
          >
            {w.text}
          </span>
        );
      })}
    </div>
  );
};

/** A run of consecutive shots of one manufacturing step. */
type StepRun = { label: string; startFrame: number };

function stepRuns(scenes: Scene[]): StepRun[] {
  const runs: StepRun[] = [];
  for (const s of scenes) {
    if (s.stepLabel && s.stepLabel !== runs.at(-1)?.label) runs.push({ label: s.stepLabel, startFrame: s.startFrame });
  }
  return runs;
}

const PartPill: React.FC<{ label: string; accentColor: string }> = ({ label, accentColor }) => (
  <div style={{ backgroundColor: "#FFFFFF", color: accentColor, fontWeight: 900, fontSize: 34, letterSpacing: 3, padding: "4px 22px", borderRadius: 999 }}>{label.toUpperCase()}</div>
);

/**
 * The band above the art. During the hook: the part and the hook. After it: the part, the series
 * title small, and the step being shown big, changing as the process moves on. Without step labels
 * (older scripts) the series title stays big.
 */
const TitleBand: React.FC<{
  layout: EpisodeProps["layout"];
  title: string;
  partLabel: string;
  accentColor: string;
  hookText: string;
  hookFrames: number;
  steps: StepRun[];
}> = ({ layout, title, partLabel, accentColor, hookText, hookFrames, steps }) => {
  const frame = useCurrentFrame();
  const geo = LAYOUTS[layout];
  const showHook = Boolean(hookText) && frame < hookFrames;
  const after = hookText ? interpolate(frame, [hookFrames, hookFrames + 6], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) : 1;
  const step = [...steps].reverse().find((s) => frame >= s.startFrame) ?? steps[0];
  const sinceStep = step ? frame - Math.max(step.startFrame, hookText ? hookFrames : 0) : 0;
  const stepIn = interpolate(sinceStep, [0, 8], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.out(Easing.cubic) });
  // Long series names step down in size so they fit in at most three lines.
  const bigTitle = title.length > 48 ? 60 : title.length > 30 ? 70 : 84;
  const stepSize = (step?.label.length ?? 0) > 22 ? 58 : 70;
  return (
    <div
      style={{
        position: "absolute",
        top: geo.titleTop,
        left: 60,
        right: 60,
        height: geo.imageTop - geo.titleTop - 20,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 14,
        textAlign: "center",
        fontFamily: FONT,
      }}
    >
      {partLabel ? <PartPill label={partLabel} accentColor={accentColor} /> : null}
      {showHook ? (
        <HookText text={hookText} endFrame={hookFrames} />
      ) : step ? (
        <div style={{ opacity: after, display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
          <div style={{ color: "rgba(255,255,255,0.78)", fontWeight: 800, fontSize: 38, lineHeight: 1.1 }}>{title}</div>
          <div
            style={{
              color: "#FFFFFF",
              fontWeight: 900,
              fontSize: stepSize,
              lineHeight: 1.05,
              textShadow: "0 4px 0 rgba(0,0,0,0.28)",
              textWrap: "balance",
              opacity: stepIn,
              transform: `translateY(${(1 - stepIn) * 18}px)`,
            }}
          >
            {step.label}
          </div>
        </div>
      ) : (
        <div style={{ color: "#FFFFFF", fontWeight: 900, fontSize: bigTitle, lineHeight: 1.05, textShadow: "0 4px 0 rgba(0,0,0,0.28)", textWrap: "balance", opacity: after }}>{title}</div>
      )}
    </div>
  );
};

const Captions: React.FC<{ captions: EpisodeProps["captions"]; layout: EpisodeProps["layout"] }> = ({ captions, layout }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const ms = (frame / fps) * 1000;
  const active = captions.find((c, i) => ms >= c.startMs && ms < (captions[i + 1]?.startMs ?? c.endMs + 400));
  if (!active) return null;
  const onBand = layout !== "full";
  const geo = LAYOUTS[layout];
  return (
    <AbsoluteFill style={{ justifyContent: "flex-start", alignItems: "center" }}>
      {/* Safe area: above the bottom ~330px (platform UI) and away from the right-edge action buttons. */}
      <div
        style={{
          position: "absolute",
          top: geo.captionTop,
          left: 90,
          right: 150,
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          gap: "0 18px",
          fontFamily: FONT,
          fontWeight: 800,
          fontSize: geo.captionSize,
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
                color: current ? INK : onBand ? (spoken ? "#FFFFFF" : "rgba(255,255,255,0.45)") : spoken ? INK : "#9A9A96",
                backgroundColor: current ? HIGHLIGHT : "transparent",
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

/** A shot's factory sound, under the narration: a loop fades in and out with the shot; a one-shot plays once from its start. */
const SceneSound: React.FC<{ url: string; loop: boolean; volume: number; durationInFrames: number }> = ({ url, loop, volume, durationInFrames }) => (
  <Audio
    src={url}
    loop={loop}
    volume={(f) =>
      volume *
      Math.min(
        loop ? interpolate(f, [0, SOUND_FADE_FRAMES], [0, 1], { extrapolateRight: "clamp" }) : 1,
        interpolate(f, [durationInFrames - SOUND_FADE_FRAMES, durationInFrames], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
      )
    }
  />
);

export const Episode: React.FC<EpisodeProps> = (props) => {
  const banded = props.layout !== "full";
  return (
    <AbsoluteFill style={{ backgroundColor: banded ? props.accentColor : BACKGROUND }}>
      {props.scenes.map((scene, i) => {
        const offset = i === 0 ? 0 : Math.min(CROSSFADE_FRAMES, scene.startFrame);
        return (
          <Sequence key={scene.sceneNumber} from={scene.startFrame - offset} durationInFrames={scene.durationInFrames + offset} name={`Scene ${scene.sceneNumber}`}>
            <SceneImage scene={scene} offset={offset} fadeIn={i > 0} layout={props.layout} />
          </Sequence>
        );
      })}
      {props.sfxVolume > 0
        ? props.scenes.map((scene) =>
            scene.sound ? (
              <Sequence key={`sound-${scene.sceneNumber}`} from={scene.startFrame} durationInFrames={scene.durationInFrames} name={`Sound ${scene.sceneNumber}`}>
                <SceneSound url={scene.sound.url} loop={scene.sound.loop} volume={props.sfxVolume} durationInFrames={scene.durationInFrames} />
              </Sequence>
            ) : null,
          )
        : null}
      {banded ? (
        <TitleBand
          layout={props.layout}
          title={props.seriesTitle}
          partLabel={props.partLabel}
          accentColor={props.accentColor}
          hookText={props.hookText}
          hookFrames={props.hookFrames}
          steps={stepRuns(props.scenes)}
        />
      ) : props.hookText ? (
        <Sequence durationInFrames={props.hookFrames} name="Hook text">
          <AbsoluteFill style={{ alignItems: "center", paddingTop: LAYOUTS.full.titleTop, paddingLeft: 70, paddingRight: 150, fontFamily: FONT, textAlign: "center" }}>
            <HookText text={props.hookText} endFrame={props.hookFrames} />
          </AbsoluteFill>
        </Sequence>
      ) : null}
      {props.showCaptions ? <Captions captions={props.captions} layout={props.layout} /> : null}
      <Audio src={props.voiceoverUrl} volume={props.voiceVolume} playbackRate={props.voicePlaybackRate} />
      {props.music ? <Audio src={props.music.url} volume={props.music.volume} loop /> : null}
    </AbsoluteFill>
  );
};
