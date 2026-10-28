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
  /** Make the first fact review demand a revision (exercises bounded corrections). */
  firstFactReviewFails?: boolean;
  /** Continuity verdict to return for Part 2+. */
  continuity?: "consistent" | "material-conflicts";
};

function emptyUpdate(part: number) {
  return {
    addCharacters: part === 1 ? [{ name: "You", role: "traveler", description: "A tired passenger", visualDescription: "backpack, round glasses", firstAppearedPart: 1 }] : [],
    updateCharacters: [],
    addLocations: [{ name: `Location ${part}`, description: "A place" }],
    addTimelineEvents: [{ part, order: 1, event: `Event of part ${part}` }],
    addEstablishedFacts: [],
    addTechnicalFacts: [{ statement: `Fact from part ${part}`, kind: "real-world" as const, part }],
    addMysteries: [],
    openThreads: [{ id: `thread-${part}`, description: `Open question from part ${part}` }],
    resolveThreads: part > 1 ? [{ id: `thread-${part - 1}`, resolution: "Answered" }] : [],
    addRevealedInformation: [`Reveal ${part}`],
    addConstraints: [],
    addRecurringVisuals: [],
    arcSummary: `Summary through part ${part}.`,
  };
}

export function makeDraft(hook: string, part: number, sceneCount = 12): EpisodeDraft {
  const words = (n: number, seed: number) => Array.from({ length: n }, (_, i) => `beat${seed}w${i}`).join(" ");
  return {
    title: `Episode part ${part}`,
    selectedHook: hook,
    summary: `Part ${part} summary.`,
    scenes: Array.from({ length: sceneCount }, (_, i) => ({
      sceneNumber: i + 1,
      narration: i === 0 ? `${hook} ${words(10, i)}.` : `${words(14, i)}.`,
      visualDescription: `visual ${i + 1}`,
      imagePrompt: `A stick figure in scene ${i + 1}`,
      composition: "wide shot",
      characters: ["You"],
      objects: ["suitcase"],
      intendedDurationSec: 6,
      motionPreset: "slow-zoom-in",
    })),
    keyReveals: [`Reveal ${part}`],
    establishedFacts: [],
    unresolvedQuestions: [`Question ${part}`],
    continuationOpportunities: ["More"],
    claims: [{ claim: "Bags are scanned", sceneNumber: 2, classification: "ESTABLISHED_FACT" }],
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
        case "hook_candidates":
          return out({
            hooks: [
              { type: "RELATABLE", text: "You land after ten hours.", scores: scores(8), rationale: "r" },
              { type: "SURPRISING_FACT", text: "Your bag travels miles before you see it.", scores: scores(6), rationale: "r" },
              { type: "IMMEDIATE_DANGER", text: "Your bag is about to vanish.", scores: scores(5), rationale: "r" },
            ],
          });
        case "episode_draft": {
          if (user.includes("Current draft (JSON):")) {
            const json = user.slice(user.indexOf("Current draft (JSON):") + "Current draft (JSON):".length).trim();
            const draft = JSON.parse(json) as EpisodeDraft;
            draft.scenes[1].narration = draft.scenes[1].narration.replace(/\.$/, " revised.");
            return out(draft);
          }
          const hook = /Selected hook: "([^"]+)"/.exec(user)?.[1] ?? "You land after ten hours.";
          const part = Number(/^Part: (\d+)/m.exec(user)?.[1] ?? 1);
          return out(makeDraft(hook, part));
        }
        case "fact_review": {
          const fail = opts.firstFactReviewFails && calls.fact_review === 1;
          return out({
            claims: [
              {
                claim: fail ? "Exactly 4,217 bags are lost per hour" : "Bags are scanned",
                sceneNumber: 2,
                classification: "ESTABLISHED_FACT",
                assessment: fail ? "presented-as-fact-but-unsupported" : "widely-documented",
                reasoning: "test",
                suggestedRevision: fail ? "Say 'many bags'" : null,
                verificationHints: ["Airline baggage handling manuals"],
              },
            ],
            verdict: fail ? "needs-revision" : "pass",
            notes: "",
          });
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

export function fakeImages(failScenes: Set<string> = new Set()): ImageProvider & { count: number } {
  const provider = {
    count: 0,
    async generate({ prompt }: { prompt: string }) {
      provider.count++;
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

export function fakeRender(): RenderClient & { renders: { durationInFrames: number; scenes: number }[] } {
  const client = {
    renders: [] as { durationInFrames: number; scenes: number }[],
    async render({ props, onProgress }: Parameters<RenderClient["render"]>[0]) {
      await onProgress({ progress: 0.5, stage: "Rendering frames" });
      client.renders.push({ durationInFrames: props.durationInFrames, scenes: props.scenes.length });
      return { url: `https://blob.test/render-${client.renders.length}.mp4?download=1`, sizeBytes: 1234, renderSeconds: 10 };
    },
  };
  return client;
}

export function fakeDeps(opts: FakeTextOptions = {}) {
  const text = fakeText(opts);
  const images = fakeImages();
  const speech = fakeSpeech();
  const render = fakeRender();
  const deps: PipelineDeps = { text, images, speech, render: () => render };
  return { deps, text, images, speech, render };
}
