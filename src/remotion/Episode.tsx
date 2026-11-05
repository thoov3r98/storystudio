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
 * Frame geometry (1080×1920). TikTok's post text and account name can cover the bottom 660px,
 * and its buttons run down the right edge from about y=840, so captions end above that area
 * and keep out of that column. The picture may sit under the overlay; the words may not.
 *
 * square: title band · square illustration (1080×1080).
 * bands:  title band · 3:2 illustration (1080×720) (landscape art, before November 2026).
 * full:   legacy 2:3 portrait art filling the frame.
 */
const CAPTION_BOTTOM_CLEARANCE = 660;
const CAPTION_LEFT = 60;
const CAPTION_RIGHT_CLEARANCE = 180;

const LAYOUTS = {
  square: { imageTop: 440, imageHeight: 1080, titleTop: 180, captionSize: 64 },
  bands: { imageTop: 560, imageHeight: 720, titleTop: 190, captionSize: 72 },
  full: { imageTop: 70, imageHeight: 1620, titleTop: 200, captionSize: 76 },
} as const;

type Scene = EpisodeProps["scenes"][number];

/** How far a push-in goes. Gentle: the art is ~1024px shown at 1080px, so more would blur. */
const PUSH = 0.14;
/** The opening dive goes much further and speeds up as it goes; the motion hides the softness. */
const DIVE = 0.65;

/**
 * One continuous camera move per shot, never a cut within it: zooms push toward (or pull back from) the
 * main action, pans drift across the whole picture, "still" breathes in slightly so nothing looks frozen.
 * Scaling ≥1 about any point inside the picture keeps the frame covered.
 */
function cameraMove(preset: string, t: number, focus: Scene["focus"]): { transform: string; transformOrigin: string } {
  // t: 0 → 1 over the shot.
  const e = Easing.inOut(Easing.quad)(t);
  const f = focus ?? { x: 0.5, y: 0.45 };
  const onFocus = `${f.x * 100}% ${f.y * 100}%`;
  switch (preset) {
    case "slow-zoom-in":
      return { transform: `scale(${1 + PUSH * e})`, transformOrigin: onFocus };
    case "dive-in":
      return { transform: `scale(${1 + DIVE * Easing.in(Easing.cubic)(t)})`, transformOrigin: onFocus };
    case "slow-zoom-out":
      return { transform: `scale(${1 + PUSH - PUSH * e})`, transformOrigin: onFocus };
    case "pan-left":
      return { transform: `scale(1.1) translateX(${interpolate(e, [0, 1], [3, -3])}%)`, transformOrigin: "50% 50%" };
    case "pan-right":
      return { transform: `scale(1.1) translateX(${interpolate(e, [0, 1], [-3, 3])}%)`, transformOrigin: "50% 50%" };
    case "pan-up":
      return { transform: `scale(1.1) translateY(${interpolate(e, [0, 1], [3, -3])}%)`, transformOrigin: "50% 50%" };
    default:
      return { transform: `scale(${1 + 0.04 * e})`, transformOrigin: onFocus };
  }
}

const SceneImage: React.FC<{ scene: Scene; offset: number; fadeIn: boolean; layout: EpisodeProps["layout"] }> = ({ scene, offset, fadeIn, layout }) => {
  const frame = useCurrentFrame();
  const own = frame - offset; // frames since the shot's own start (the crossfade starts before it)
  const t = Math.min(1, Math.max(0, own) / Math.max(1, scene.durationInFrames));
  const opacity = fadeIn ? interpolate(frame, [0, CROSSFADE_FRAMES], [0, 1], { extrapolateRight: "clamp" }) : 1;
  const geo = LAYOUTS[layout];
  return (
    <AbsoluteFill style={{ opacity }}>
      <div style={{ position: "absolute", left: 0, width: "100%", overflow: "hidden", top: geo.imageTop, height: geo.imageHeight, backgroundColor: BACKGROUND }}>
        <Img src={scene.imageUrl} style={{ width: "100%", height: "100%", objectFit: "cover", ...cameraMove(scene.motionPreset, t, scene.focus) }} />
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
  // With a step line under it, the title stays the big text but leaves room for the step.
  const titleWithStep = title.length > 48 ? 52 : title.length > 30 ? 60 : 68;
  const stepSize = (step?.label.length ?? 0) > 22 ? 36 : 42;
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
        <div style={{ opacity: after, display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
          <div style={{ color: "#FFFFFF", fontWeight: 900, fontSize: titleWithStep, lineHeight: 1.05, textShadow: "0 4px 0 rgba(0,0,0,0.28)", textWrap: "balance" }}>{title}</div>
          <div
            style={{
              color: "rgba(255,255,255,0.85)",
              fontWeight: 800,
              fontSize: stepSize,
              lineHeight: 1.1,
              textWrap: "balance",
              opacity: stepIn,
              transform: `translateY(${(1 - stepIn) * 12}px)`,
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
  const geo = LAYOUTS[layout];
  return (
    <AbsoluteFill>
      {/* Anchored by its bottom edge, so longer captions grow upward instead of into TikTok's overlay. */}
      <div style={{ position: "absolute", bottom: CAPTION_BOTTOM_CLEARANCE, left: CAPTION_LEFT, right: CAPTION_RIGHT_CLEARANCE, display: "flex", justifyContent: "center" }}>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "center",
            gap: "0 18px",
            padding: "12px 20px",
            borderRadius: 24,
            // The captions sit over the art, so this backing keeps them readable on any picture.
            backgroundColor: "rgba(17,17,17,0.78)",
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
                  color: current ? INK : spoken ? "#FFFFFF" : "rgba(255,255,255,0.55)",
                  backgroundColor: current ? HIGHLIGHT : "transparent",
                  borderRadius: 12,
                  padding: "0 8px",
                }}
              >
                {w.text}
              </span>
            );
          })}
        </div>
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
      {props.voiceClips.length ? (
        props.voiceClips.map((clip, i) => (
          <Sequence key={`voice-${i}`} from={clip.fromFrame} durationInFrames={Math.max(1, Math.ceil(clip.sourceFrames / props.voicePlaybackRate))} name={`Voice ${i + 1}`} layout="none">
            <Audio src={props.voiceoverUrl} volume={props.voiceVolume} playbackRate={props.voicePlaybackRate} trimBefore={clip.trimBefore} durationInFrames={clip.sourceFrames} />
          </Sequence>
        ))
      ) : (
        <Audio src={props.voiceoverUrl} volume={props.voiceVolume} playbackRate={props.voicePlaybackRate} />
      )}
      {props.music ? <Audio src={props.music.url} volume={props.music.volume} loop /> : null}
    </AbsoluteFill>
  );
};
