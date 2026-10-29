/*
 * Deterministic fake providers for integration tests ONLY. They return
 * schema-valid data so the real pipeline, database writes and versioning
 * can be exercised without network calls or spend.
 */
import type { StructuredTextClient } from "@/lib/ai/structured";
import type { ImageProvider } from "@/lib/providers/images";
import type { SpeechProvider } from "@/lib/providers/speech";
import type { RenderClient } from "@/lib/render/client";
import type { PipelineDeps } from "@/lib/pipeline/deps";
import type { EpisodeDraft } from "@/lib/schemas/episode";


const PRODUCTS = ["Pencils", "Glass bottles", "Tennis balls", "Chocolate bars", "Toothpaste", "Sneakers", "Paper cups", "Marbles", "Candles", "Soap", "Gummy bears"];

export type FakeTextOptions = {
  /** Fact-check: an unsupported claim that one revision fixes or that never goes away, or a contradiction that never goes away. */
  processAudit?: "pass" | "significant-once" | "significant-always" | "blocking-always";
};

const AUDIT_ISSUE = (severity: string, evidence: string) => ({
  category: "unsupported-claim",
  severity,
  kind: "contradiction",
  location: "Sentence 2",
  evidence,
  problem: "The research doesn't say this.",
  repair: "Say only what the research gives.",
});

const between = (text: string, start: string, end?: string) => {
  const a = text.indexOf(start);
  if (a < 0) return "";
  const from = a + start.length;
  const b = end ? text.indexOf(end, from) : -1;
  return text.slice(from, b < 0 ? undefined : b).trim();
};

/** Issue ids listed in a revision prompt ("- S1.1: ..."). */
const issueIds = (user: string) => [...user.matchAll(/^- ([A-Z]\d+\.\d+): /gm)].map((m) => m[1]);

/** Cuts narration into shots the way makeDraft does: the opening travels with its first sentence. */
function cutScenes(narration: string) {
  const sentences = narration.split(/(?<=\.)\s+/);
  const shots = sentences.length > 12 ? [`${sentences[0]} ${sentences[1]}`, ...sentences.slice(2)] : sentences;
  return shots.map((n, i) => ({
    sceneNumber: i + 1,
    narration: n,
    imagePrompt: `A machine at work in scene ${i + 1}`,
    composition: "wide shot",
    continuity: `On the factory floor, scene ${i + 1}`,
    characters: [] as string[],
    objects: ["mould"],
    motionPreset: "slow-zoom-in" as const,
  }));
}

export function makeDraft(hook: string, part: number, sceneCount = 12): EpisodeDraft {
  const words = (n: number, seed: number) => Array.from({ length: n }, (_, i) => `step${seed}w${i}`).join(" ");
  const narrations = Array.from({ length: sceneCount }, (_, i) => (i === 0 ? `${hook} ${words(10, i)}.` : `${words(14, i)}.`));
  return {
    title: `Episode part ${part}`,
    storyNarration: narrations.join(" "),
    selectedHook: hook,
    summary: `Part ${part} summary.`,
    visualState: { setting: "A crayon factory", timeAndLight: "Bright factory lighting", weather: "Indoors", heroSituation: "Liquid wax at the start, solid crayons by the end", heroLook: "Workers in hairnets", rules: ["No text on any machine"] },
    scenes: cutScenes(narrations.join(" ")),
  };
}

export function fakeText(opts: FakeTextOptions = {}): StructuredTextClient & { calls: Record<string, number>; prompts: Record<string, string[]>; models: Record<string, string> } {
  const calls: Record<string, number> = {};
  const prompts: Record<string, string[]> = {};
  const models: Record<string, string> = {};
  let pitchCounter = 0;
  return {
    calls,
    prompts,
    models,
    async generate({ schemaName, system, user, model }) {
      calls[schemaName] = (calls[schemaName] ?? 0) + 1;
      models[schemaName] = model;
      (prompts[schemaName] ??= []).push(user);
      const usage = { inputTokens: 1000, cachedInputTokens: 0, outputTokens: 500 };
      const out = (parsed: unknown) => ({ parsed, usage, model: "fake-model" });

      switch (schemaName) {
        case "channel_design":
          return out({
            name: "How Toys Are Made",
            minParts: 2,
            maxParts: 3,
            profile: {
              summary: "How everyday toys are made.",
              subjects: "One toy per series.",
              voice: "Calm, plain, third person.",
              structure: "Factory order, one or two stages per part.",
              avoid: ["Brand names"],
              surpriseMe: "Pick a toy not covered yet.",
              examples: ["Marbles", "Yo-yos", "Rubber ducks"],
            },
          });
        case "pitch_batch": {
          const n = Number(/Pitch exactly (\d+)/.exec(user)?.[1] ?? 6);
          return out({
            pitches: Array.from({ length: n }, () => {
              const i = pitchCounter++;
              const product = PRODUCTS[i % PRODUCTS.length];
              // The 4th pitch repeats the channel's existing "How Crayons Are Made" story.
              const title = i === 3 ? "How Crayons Are Made" : `${product} from start to finish ${i}`;
              return {
                title,
                premise: i === 3 ? "How wax crayons are made in a factory." : `How ${product.toLowerCase()} number ${i} are made, zebra${i} quartz${i}.`,
                logline: `Logline ${i}`,
                keywords: [product.toLowerCase(), `k${i}`],
                openingSituation: `It starts as raw ${product.toLowerCase()} material`,
                arc: "Raw material. Shaping. Finishing. Packing.",
              };
            }),
          });
        }
        case "pitch_pick": {
          const n = (user.match(/^\[\d+\]/gm) ?? []).length;
          const keep = Math.min(n, Number(/Choose the (\d+) pitches/.exec(system)?.[1] ?? 3));
          return out({ picks: Array.from({ length: keep }, (_, i) => ({ index: n - 1 - i, reason: `Works because ${i}.` })) });
        }
        case "research_notes":
          return out({
            product: "Crayons",
            overview: "Crayons are paraffin wax and pigment, melted, moulded, wrapped and boxed.",
            mainRoute: "From paraffin wax, melted and moulded.",
            stages: ["Melting the wax", "Moulding", "Wrapping", "Boxing"].map((name, i) => ({
              id: `T${i + 1}`,
              name,
              steps: [{ what: `${name} happens.`, details: i === 0 ? "about 80 degrees Celsius" : "", sources: ["1"] }],
            })),
            uncertain: ["How many colours are made a day"],
          });
        case "process_plan": {
          const [, min, max] = /across (\d+)–(\d+) videos/.exec(system) ?? ["", "1", "1"];
          const stages = [...user.matchAll(/^(T\d+) /gm)].map((m) => m[1]);
          const count = Math.max(Number(min), Math.min(Number(max), stages.length));
          const per = Math.ceil(stages.length / count);
          return out({
            parts: Array.from({ length: count }, (_, i) => ({
              part: i + 1,
              title: `Stage group ${i + 1}`,
              stages: stages.slice(i * per, (i + 1) * per),
              opening: i === 0 ? "This is how crayons are made." : `Crayons, part ${i + 1}.`,
              endsAt: i === count - 1 ? "Boxed and shipped" : `Stage group ${i + 2}`,
            })),
          });
        }
        case "process_narration": {
          const part = Number(/Narration for Part (\d+)/i.exec(system)?.[1] ?? 1);
          const d = makeDraft(part === 1 ? "This is how crayons are made." : `Crayons, part ${part}.`, part);
          return out({ title: `How crayons are made, part ${part}`, storyNarration: d.storyNarration, summary: `Part ${part} of crayons.` });
        }
        case "process_audit": {
          const narration = between(user, "SCRIPT\n");
          const quote = narration.split(" ").slice(6, 12).join(" ");
          const fail = opts.processAudit === "blocking-always" || opts.processAudit === "significant-always" || (opts.processAudit === "significant-once" && calls.process_audit === 1);
          return out({
            intendedUnknowns: [],
            issues: fail ? [AUDIT_ISSUE(opts.processAudit === "blocking-always" ? "blocking" : "significant", quote)] : [],
            previousIssues: user.includes("EARLIER ISSUES") ? issueIds(user).map((id) => ({ id, resolved: !fail, note: "" })) : [],
          });
        }
        case "process_revision": {
          const narration = between(user, "CURRENT SCRIPT", "\u0000").replace(/^\(Part .*\)\n/, "");
          const sentences = narration.split(/(?<=\.)\s+/);
          sentences[2] = sentences[2].replace(/\.$/, " revised.");
          return out({ title: "Revised crayons", storyNarration: sentences.join(" "), summary: "Revised.", changeLog: issueIds(user).map((issueId) => ({ issueId, change: "Kept to the research." })) });
        }
        case "scene_breakdown": {
          const narration = between(user, "FINAL NARRATION", "\u0000").replace(/^— ".*"\n/, "");
          return out({ visualState: makeDraft("x", 1).visualState, scenes: cutScenes(narration) });
        }
        case "scene_rewrite": {
          const current = /CURRENT shot \d+ narration: (.*)/.exec(user)?.[1] ?? "x";
          return out({ narration: current.replace(/\.$/, " rewritten."), imagePrompt: "A different machine at work", composition: "close-up", rationale: "r" });
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
      const scene = [...(opts.rejectOnce ?? [])].find((n) => prompt.includes(`scene ${n}"`) || prompt.includes(`step${Number(n) - 1}w`));
      const reject = scene !== undefined && !rejected.has(scene);
      if (reject) rejected.add(scene);
      return {
        review: { pass: !reject, containsText: false, styleViolations: reject ? ["The crayons are already boxed at the melting step"] : [], matchesScene: !reject, notes: "" },
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

/** Web research that returns a fixed report about crayons. */
export function fakeResearch() {
  const client = {
    calls: 0,
    async search() {
      client.calls++;
      return {
        text: "Crayons are made from paraffin wax and powdered pigment. ".repeat(10),
        sources: [{ url: "https://example.test/crayons", title: "How crayons are made" }],
        searches: 2,
        model: "gpt-test",
        usage: { inputTokens: 1000, cachedInputTokens: 0, outputTokens: 800 },
      };
    },
  };
  return client;
}

export function fakeDeps(opts: FakeTextOptions = {}, imageOpts: { rejectOnce?: Set<string> } = {}) {
  const text = fakeText(opts);
  const images = fakeImages(new Set(), imageOpts);
  const speech = fakeSpeech();
  const render = fakeRender();
  const research = fakeResearch();
  const deps: PipelineDeps = { text, research, images, speech, render: () => render };
  return { deps, text, images, speech, render, research };
}
