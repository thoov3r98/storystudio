/*
 * Deterministic fake providers for integration tests ONLY. They return
 * schema-valid data so the real pipeline, database writes, versioning and
 * continuity logic can be exercised without network calls or spend.
 */
import type { StructuredTextClient } from "@/lib/ai/structured";
import type { ImageProvider } from "@/lib/providers/images";
import type { SpeechProvider } from "@/lib/providers/speech";
import type { RenderClient } from "@/lib/render/client";
import type { PipelineDeps } from "@/lib/pipeline/deps";
import { CRITERIA } from "@/lib/schemas/concept";
import type { EpisodeDraft } from "@/lib/schemas/episode";

const scores = (n: number) => Object.fromEntries(CRITERIA.map((c) => [c.key, { score: n, rationale: "test" }]));

const SUBJECTS = ["luggage", "water", "elevators", "subway", "mail", "ports", "power", "satellites", "bridges", "sewers", "trains", "hospitals", "shipping", "airports", "tunnels", "dams", "trucks", "ferries", "cables", "grain"];

export type FakeTextOptions = {
  /** Continuity verdict to return for Part 2+. */
  continuity?: "consistent" | "material-conflicts";
  /** Story editor verdict on the first script. */
  storyReview?: "pass" | "revise";
};

const OUTLINE = {
  logline: "A traveller's shortcut strands them.",
  trigger: "They skip the queue.",
  stakes: "Their flight in an hour.",
  escalations: ["Bag lost", "Phone dies", "Gate moves"],
  cleverMove: "Tracks the bag by its tag.",
  funnyMoment: "Argues with a vending machine.",
  endingTurn: "The bag is on another plane.",
  beats: ["b1", "b2", "b3", "b4", "b5", "b6"],
};

function emptyUpdate(part: number) {
  return {
    addCharacters: part === 1 ? [{ name: "You", role: "traveler", description: "A tired passenger", visualDescription: "backpack, round glasses", firstAppearedPart: 1 }] : [],
    updateCharacters: [],
    addLocations: [{ name: `Location ${part}`, description: "A place" }],
    addTimelineEvents: [{ part, order: 1, event: `Event of part ${part}` }],
    addMysteries: [],
    openThreads: [{ id: `thread-${part}`, description: `Open question from part ${part}` }],
    resolveThreads: part > 1 ? [{ id: `thread-${part - 1}`, resolution: "Answered" }] : [],
    addRevealedInformation: [`Reveal ${part}`],
    addConstraints: [],
    addRecurringVisuals: [],
    arcSummary: `Summary through part ${part}.`,
  };
}

export function makeDraft(hook: string, part: number, sceneCount = 12, hero = "You"): EpisodeDraft {
  const words = (n: number, seed: number) => Array.from({ length: n }, (_, i) => `beat${seed}w${i}`).join(" ");
  const narrations = Array.from({ length: sceneCount }, (_, i) => (i === 0 ? `${hook} ${words(10, i)}.` : `${words(14, i)}.`));
  return {
    title: `Episode part ${part}`,
    storyNarration: narrations.join(" "),
    selectedHook: hook,
    summary: `Part ${part} summary.`,
    visualState: { setting: "A busy airport hall", timeAndLight: "Evening, bright indoor light", weather: "Indoors", heroSituation: "On foot in the terminal", heroLook: "Backpack", rules: ["The traveller stays inside the terminal"] },
    scenes: Array.from({ length: sceneCount }, (_, i) => ({
      sceneNumber: i + 1,
      narration: narrations[i],
      imagePrompt: `A stick figure in scene ${i + 1}`,
      composition: "wide shot",
      continuity: `Still in the terminal, scene ${i + 1}`,
      // Scene 5 is a cutaway without the hero.
      characters: i === 4 ? [] : [hero],
      objects: ["suitcase"],
      motionPreset: "slow-zoom-in",
    })),
    keyReveals: [`Reveal ${part}`],
    unresolvedQuestions: [`Question ${part}`],
    bibleUpdate: emptyUpdate(part),
  };
}

export function fakeText(opts: FakeTextOptions = {}): StructuredTextClient & { calls: Record<string, number>; prompts: Record<string, string[]> } {
  const calls: Record<string, number> = {};
  const prompts: Record<string, string[]> = {};
  let conceptCounter = 0;
  return {
    calls,
    prompts,
    async generate({ schemaName, user }) {
      calls[schemaName] = (calls[schemaName] ?? 0) + 1;
      (prompts[schemaName] ??= []).push(user);
      const usage = { inputTokens: 1000, cachedInputTokens: 0, outputTokens: 500 };
      const out = (parsed: unknown) => ({ parsed, usage, model: "fake-model" });

      switch (schemaName) {
        case "character_profile":
          return out({
            name: "Big Dave",
            tagline: "An ex-trucker who keeps ending up stranded",
            personality: "Calm, stubborn and funny under pressure.",
            backstory: "Drove long-haul for twenty years and fixes most things with duct tape.",
            speakingStyle: "Slow, dry, plain-spoken.",
            visualDescription: "Big round stick figure with a beard, red flannel shirt and a trucker cap.",
            signatureColor: "#C62828",
          });
        case "concept_batch": {
          const n = Number(/Pitch exactly (\d+)/.exec(user)?.[1] ?? 4);
          return out({
            concepts: Array.from({ length: n }, () => {
              const i = conceptCounter++;
              const subject = SUBJECTS[i % SUBJECTS.length];
              // The 4th concept duplicates the library's "lost luggage" story.
              const title = i === 3 ? "Where Does Lost Luggage Go?" : `The Secret Life of ${subject} ${i}`;
              return {
                title,
                premise: i === 3 ? "Your lost suitcase travels through hidden baggage systems at the airport." : `Unique premise about ${subject} number ${i} and zebra${i} quartz${i}.`,
                logline: `Logline ${i}`,
                category: "hidden-infrastructure",
                keywords: [subject, `k${i}`],
                factMode: "MIXED",
                openingSituation: `You notice ${subject}`,
                seriesPotential: "Many parts",
              };
            }),
          });
        }
        case "concept_evaluation": {
          const n = (user.match(/^\[\d+\]/gm) ?? []).length;
          return out({ evaluations: Array.from({ length: n }, (_, i) => ({ conceptIndex: i, scores: scores(4 + ((i * 3) % 6)), summary: "ok" })) });
        }
        case "episode_draft": {
          if (user.includes("Current draft (JSON):")) {
            const json = user.slice(user.indexOf("Current draft (JSON):") + "Current draft (JSON):".length).trim();
            const draft = JSON.parse(json) as EpisodeDraft;
            draft.scenes[1].narration = draft.scenes[1].narration.replace(/\.$/, " revised.");
            draft.storyNarration = draft.scenes.map((s) => s.narration).join(" ");
            return out(draft);
          }
          const hook = "You land after ten hours.";
          const part = Number(/^Part: (\d+)/m.exec(user)?.[1] ?? 1);
          const hero = /NARRATOR AND HERO: (.+?) —/.exec(user)?.[1];
          return out(makeDraft(hook, part, 12, hero));
        }
        case "story_outlines":
          return out({ outlines: [OUTLINE, { ...OUTLINE, logline: "Second outline" }, { ...OUTLINE, logline: "Third outline" }] });
        case "outline_pick":
          return out({
            reviews: [0, 1, 2].map((index) => ({ index, stakes: 7, escalation: 7, character: 7, ending: 7, note: "n" })),
            chosenIndex: 1,
            improvements: ["Make the ending sharper"],
          });
        case "story_review": {
          const revise = opts.storyReview === "revise" && (calls.story_review ?? 0) === 1;
          const n = revise ? 5 : 8;
          return out({ scores: { hook: n, stakes: n, escalation: n, character: n, ending: n, flow: n }, notes: revise ? ['The ending "x" is a status report; end on a turn.'] : [] });
        }
        case "continuity_review":
          return out(
            opts.continuity === "material-conflicts"
              ? { issues: [{ type: "character-contradiction", severity: "material", description: "Maya changed jobs", sceneNumber: 3, suggestedFix: "Keep her job" }], verdict: "material-conflicts" }
              : { issues: [], verdict: "consistent" },
          );
        case "scene_rewrite": {
          const current = /CURRENT scene \d+ narration: (.*)/.exec(user)?.[1] ?? "x";
          return out({ narration: current.replace(/\.$/, " rewritten."), imagePrompt: "A different stick figure scene", composition: "close-up", rationale: "r" });
        }
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
      const scene = [...(opts.rejectOnce ?? [])].find((n) => prompt.includes(`scene ${n}"`) || prompt.includes(`beat${Number(n) - 1}w`));
      const reject = scene !== undefined && !rejected.has(scene);
      if (reject) rejected.add(scene);
      return {
        review: { pass: !reject, containsText: false, styleViolations: reject ? ["Hero is standing on the ground"] : [], matchesScene: !reject, notes: "" },
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

type RenderCall = { durationInFrames: number; scenes: number; layout: string; seriesTitle: string; partLabel: string; accentColor: string };

export function fakeRender(): RenderClient & { renders: RenderCall[] } {
  const client = {
    renders: [] as RenderCall[],
    async render({ props, onProgress }: Parameters<RenderClient["render"]>[0]) {
      await onProgress({ progress: 0.5, stage: "Rendering frames" });
      const { durationInFrames, layout, seriesTitle, partLabel, accentColor } = props;
      client.renders.push({ durationInFrames, scenes: props.scenes.length, layout, seriesTitle, partLabel, accentColor });
      return { url: `https://blob.test/render-${client.renders.length}.mp4?download=1`, sizeBytes: 1234, renderSeconds: 10 };
    },
  };
  return client;
}

export function fakeDeps(opts: FakeTextOptions = {}, imageOpts: { rejectOnce?: Set<string> } = {}) {
  const text = fakeText(opts);
  const images = fakeImages(new Set(), imageOpts);
  const speech = fakeSpeech();
  const render = fakeRender();
  const deps: PipelineDeps = { text, images, speech, render: () => render };
  return { deps, text, images, speech, render };
}
