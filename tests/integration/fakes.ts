/*
 * Deterministic fake providers for integration tests ONLY. They return
 * schema-valid data so the real pipeline, database writes and versioning
 * can be exercised without network calls or spend.
 */
import type { StructuredTextClient } from "@/lib/ai/structured";
import type { ImageProvider } from "@/lib/providers/images";
import type { SpeechProvider } from "@/lib/providers/speech";
import type { SoundProvider } from "@/lib/providers/sound";
import type { RenderClient } from "@/lib/render/client";
import type { PipelineDeps } from "@/lib/pipeline/deps";
import type { EpisodeDraft } from "@/lib/schemas/episode";

export type FakeTextOptions = {
  /** The storyboard's first attempt drops a word, so the exact-cut check sends it back. */
  storyboardDropWordOnce?: boolean;
  /** The split never returns valid breaks, so the even split is used. */
  splitAlwaysBad?: boolean;
};

/**
 * A pasted script: an opening line, then sentences of distinctive words
 * ("step3w0 … step3w11.") so a shot's narration can be found in prompts.
 */
export function makeScript(sentences: number, opening = "This is how crayons are made."): string {
  const words = (seed: number) => Array.from({ length: 12 }, (_, i) => `step${seed}w${i}`).join(" ");
  return [opening, ...Array.from({ length: sentences - 1 }, (_, i) => `${words(i + 1)}.`)].join(" ");
}

/**
 * One shot per sentence, the way a storyboard artist might copy it: lowercase and
 * without punctuation (the exact-cut check compares words, and code restores the producer's text).
 */
function cutScenes(narration: string) {
  const sentences = narration.split(/(?<=\.)\s+/);
  return sentences.map((n, i) => ({
    sceneNumber: i + 1,
    narration: n.toLowerCase().replace(/[.,]/g, ""),
    imagePrompt: `A machine at work in scene ${i + 1}`,
    composition: "wide shot",
    continuity: `On the factory floor, scene ${i + 1}`,
    characters: [] as string[],
    objects: ["mould"],
    motionPreset: "slow-zoom-in" as const,
    soundEffect: i % 2 === 0 ? ("press" as const) : ("conveyor" as const),
    stepLabel: i < 4 ? "Melting the wax" : "Moulding the crayons",
  }));
}

/** A storyboarded part as the pipeline saves it: one shot per sentence, in the producer's own words. */
export function makeDraft(script: string, part = 1): EpisodeDraft {
  const scenes = cutScenes(script).map((s, i) => ({ ...s, narration: script.split(/(?<=\.)\s+/)[i] }));
  return { title: `Crayons part ${part}`, storyNarration: script, selectedHook: scenes[0].narration, summary: `Part ${part} of crayons.`, onScreenHook: "It starts as *wax*", visualState: FAKE_VISUAL_STATE, scenes };
}

export const FAKE_VISUAL_STATE = {
  setting: "A crayon factory",
  timeAndLight: "Bright factory lighting",
  weather: "Indoors",
  heroSituation: "Liquid wax at the start, solid crayons by the end",
  heroLook: "Workers in hairnets",
  rules: ["No text on any machine"],
};

export function fakeText(opts: FakeTextOptions = {}): StructuredTextClient & { calls: Record<string, number>; prompts: Record<string, string[]>; systems: Record<string, string[]>; models: Record<string, string> } {
  const calls: Record<string, number> = {};
  const prompts: Record<string, string[]> = {};
  const systems: Record<string, string[]> = {};
  const models: Record<string, string> = {};
  let dropped = false;
  return {
    calls,
    prompts,
    systems,
    models,
    async generate({ schemaName, system, user, model }) {
      calls[schemaName] = (calls[schemaName] ?? 0) + 1;
      models[schemaName] = model;
      (prompts[schemaName] ??= []).push(user);
      (systems[schemaName] ??= []).push(system);
      const usage = { inputTokens: 1000, cachedInputTokens: 0, outputTokens: 500 };
      const out = (parsed: unknown) => ({ parsed, usage, model: "fake-model" });

      switch (schemaName) {
        case "script_split": {
          const n = Number(/SCRIPT \((\d+) sentences\)/.exec(user)?.[1] ?? 0);
          const parts = Number(/into (\d+) consecutive/.exec(system)?.[1] ?? 1);
          if (opts.splitAlwaysBad) return out({ seriesTitle: "Bad", breaks: [1] });
          const per = Math.round(n / parts);
          return out({ seriesTitle: "How Crayons Are Made", breaks: Array.from({ length: parts - 1 }, (_, i) => 1 + per * (i + 1)) });
        }
        case "storyboard": {
          // The narration runs to the end of the prompt, or to the feedback a retry appends.
          const narration = user.slice(user.indexOf("\n", user.indexOf("NARRATION TO STORYBOARD")) + 1).split("\n\n---\n")[0].trim();
          const part = Number(/Part (\d+) of \d+/.exec(system)?.[1] ?? 1);
          const scenes = cutScenes(narration);
          if (opts.storyboardDropWordOnce && !dropped) {
            dropped = true;
            scenes[1].narration = scenes[1].narration.split(" ").slice(1).join(" ");
          }
          return out({ title: `Crayons part ${part}`, summary: `Part ${part} of crayons.`, onScreenHook: "It starts as *wax*", visualState: FAKE_VISUAL_STATE, scenes });
        }
        case "post_copy":
          return out({
            caption: "Watch wax turn into crayons.",
            hashtags: ["#howitsmade", "#crayons", "#factory"],
            coverSceneNumber: 1,
            coverText: "How crayons are made",
            pinnedComment: "Which step surprised you most?",
          });
        default:
          throw new Error(`fakeText: unhandled schema ${schemaName}`);
      }
    },
  };
}

export function fakeImages(
  failScenes: Set<string> = new Set(),
  opts: { rejectOnce?: Set<string> } = {},
): ImageProvider & { count: number; calls: { prompt: string; size?: string; references: number }[]; reviews: number } {
  const rejected = new Set<string>();
  const provider = {
    count: 0,
    reviews: 0,
    calls: [] as { prompt: string; size?: string; references: number }[],
    // Passes every image, except the first image of each scene listed in rejectOnce.
    async review({ prompt }: { png: Buffer; prompt: string; model: string }) {
      provider.reviews++;
      const scene = [...(opts.rejectOnce ?? [])].find((n) => prompt.includes(`scene ${n}"`) || prompt.includes(`step${Number(n) - 1}w`));
      const reject = scene !== undefined && !rejected.has(scene);
      if (reject) rejected.add(scene);
      return {
        review: { pass: !reject, containsText: false, styleViolations: reject ? ["The crayons are already boxed at the melting step"] : [], matchesScene: !reject, notes: "", focus: { x: 0.3, y: 0.6 } },
        usage: { inputTokens: 500, cachedInputTokens: 0, outputTokens: 50 },
        model: "fake-model",
      };
    },
    async generate({ prompt, size, references }: { prompt: string; size?: string; references: Buffer[] }) {
      provider.count++;
      provider.calls.push({ prompt, size, references: references.length });
      const scene = /scene (\d+)/.exec(prompt)?.[1];
      if (scene && failScenes.has(scene)) throw new Error(`content_policy_violation for scene ${scene}`);
      return { png: Buffer.from(`png:${prompt.length}`), model: "fake-image", usage: { textInputTokens: 100, imageInputTokens: 0, outputTokens: 1000 }, usedReference: false };
    },
  };
  return provider;
}

function cbrMp3(durationMs: number): Buffer {
  const frames = Math.ceil(((durationMs / 1000) * 44100) / 1152);
  const frameLen = Math.floor((144 * 128_000) / 44_100);
  const buf = Buffer.alloc(frames * frameLen);
  for (let f = 0; f < frames; f++) {
    const o = f * frameLen;
    buf[o] = 0xff;
    buf[o + 1] = 0xfb;
    buf[o + 2] = 0x90;
    buf[o + 3] = 0x64;
  }
  return buf;
}

export function fakeSpeech(): SpeechProvider & { count: number } {
  const provider = {
    count: 0,
    async synthesize({ text }: { text: string }) {
      provider.count++;
      const characters = [...text];
      const starts: number[] = [];
      const ends: number[] = [];
      let t = 0.05;
      for (const ch of characters) {
        starts.push(t);
        t += ch === " " ? 0.03 : ch === "." ? 0.3 : 0.055;
        ends.push(t);
      }
      return { mp3: cbrMp3(t * 1000 + 200), alignment: { characters, characterStartTimesSeconds: starts, characterEndTimesSeconds: ends }, modelId: "fake-tts" };
    },
  };
  return provider;
}

type RenderCall = {
  durationInFrames: number;
  scenes: number;
  layout: string;
  seriesTitle: string;
  partLabel: string;
  accentColor: string;
  hookText: string;
  hookFrames: number;
  sounds: number;
  music: boolean;
  steps: string[];
  focused: number;
};

export function fakeRender(): RenderClient & { renders: RenderCall[] } {
  const client = {
    renders: [] as RenderCall[],
    async render({ props, onProgress }: Parameters<RenderClient["render"]>[0]) {
      await onProgress({ progress: 0.5, stage: "Rendering frames" });
      const { durationInFrames, layout, seriesTitle, partLabel, accentColor, hookText } = props;
      client.renders.push({
        durationInFrames,
        scenes: props.scenes.length,
        layout,
        seriesTitle,
        partLabel,
        accentColor,
        hookText,
        hookFrames: props.hookFrames,
        sounds: props.scenes.filter((s) => s.sound).length,
        music: Boolean(props.music),
        steps: [...new Set(props.scenes.map((s) => s.stepLabel))],
        focused: props.scenes.filter((s) => s.focus).length,
      });
      return { url: `https://blob.test/render-${client.renders.length}.mp4?download=1`, sizeBytes: 1234, renderSeconds: 10 };
    },
  };
  return client;
}

/** Sound effects and music: a tiny valid MP3 per call. */
export function fakeSound(): SoundProvider & { calls: { effects: number; music: number } } {
  const provider = {
    calls: { effects: 0, music: 0 },
    async effect({ durationSeconds }: { durationSeconds: number }) {
      provider.calls.effects++;
      return { mp3: cbrMp3(durationSeconds * 1000), model: "fake-sfx" };
    },
    async music({ lengthMs }: { lengthMs: number }) {
      provider.calls.music++;
      return { mp3: cbrMp3(lengthMs), model: "fake-music" };
    },
  };
  return provider;
}

export function fakeDeps(opts: FakeTextOptions = {}, imageOpts: { rejectOnce?: Set<string> } = {}) {
  const text = fakeText(opts);
  const images = fakeImages(new Set(), imageOpts);
  const speech = fakeSpeech();
  const sound = fakeSound();
  const render = fakeRender();
  const deps: PipelineDeps = { text, images, speech, sound, render: () => render };
  return { deps, text, images, speech, sound, render };
}
