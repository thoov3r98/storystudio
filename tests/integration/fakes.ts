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
  /** Attention audit: a pacing problem that never goes away (never blocking). */
  attention?: "pass" | "significant-always";
  /** Topic ideas: the first attempt cites a reference id that doesn't exist. */
  topicBadReferenceOnce?: boolean;
};

/** The hook the fakes recommend for each pattern; FACTORY_REVEAL's matches the existing opening. */
export const FAKE_HOOKS: Record<string, string> = {
  FACTORY_REVEAL: "This is how crayons are made.",
  TRANSFORMATION: "Melted wax turns into crayons.",
  HIDDEN_PROBLEM: "Moulding crayons takes real care.",
};

const TOPIC_PRODUCTS = [
  ["Plastic buckets", "household"],
  ["Glass marbles", "toys"],
  ["Ice cube trays", "kitchen tools"],
  ["Steel nails", "hardware"],
  ["Paper cups", "packaging"],
  ["Toothbrushes", "personal care"],
  ["Rubber balls", "sports"],
  ["Clothes pegs", "household goods"],
  ["Crayons", "art supplies"],
] as const;

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

export function fakeText(opts: FakeTextOptions = {}): StructuredTextClient & { calls: Record<string, number>; prompts: Record<string, string[]>; systems: Record<string, string[]>; models: Record<string, string> } {
  const calls: Record<string, number> = {};
  const prompts: Record<string, string[]> = {};
  const systems: Record<string, string[]> = {};
  const models: Record<string, string> = {};
  let pitchCounter = 0;
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
          const hook = /Open with this approved hook, word for word or tightened, never replaced or embellished: "(.*?)"\./.exec(system)?.[1];
          const d = makeDraft(part === 1 ? (hook ?? "This is how crayons are made.") : `Crayons, part ${part}.`, part);
          return out({ title: `How crayons are made, part ${part}`, storyNarration: d.storyNarration, summary: `Part ${part} of crayons.` });
        }
        case "storytelling_decision": {
          const stages = [...user.matchAll(/^(T\d+) /gm)].map((m) => m[1]);
          const pattern = /The producer has chosen (\w+)\./.exec(system)?.[1] ?? "FACTORY_REVEAL";
          return out({
            pattern,
            reason: `The research shows a fast moulding line (${pattern}).`,
            curiosityMechanism: "How liquid wax becomes a crayon.",
            featuredStageId: stages[1] ?? stages[0],
            visualPayoff: "Crayons pop out of the mould.",
            alternatives: ["TRANSFORMATION", "HIDDEN_PROBLEM", "FACTORY_REVEAL"].filter((x) => x !== pattern).slice(0, 1),
            stageVisuals: stages.map((id) => ({ stageId: id, visualSubject: `Stage ${id}`, operation: "It happens.", materialBefore: "wax", materialAfter: "crayons", machinery: "", visualMoment: "The moment.", claimIds: [`${id}.1`] })),
          });
        }
        case "hook_candidates": {
          const pattern = /^Pattern: (TRANSFORMATION|HIDDEN_PROBLEM|FACTORY_REVEAL) \(/m.exec(system)?.[1] ?? "FACTORY_REVEAL";
          const visual = { visualSubject: "wax", operation: "melting", materialBefore: "wax blocks", materialAfter: "liquid wax", machinery: "", visualMoment: "Wax melts." };
          const hook = (line: string, strategy: string, claimIds: string[]) => ({ line, strategy, claimIds, featuredStageId: "T2", firstFrameVisual: "A tray of wax.", whyItWorks: "It is clear.", uncertainty: "", visual });
          return out({
            hooks: [
              hook(FAKE_HOOKS[pattern], "intriguing-operation", ["T1.1", "T2.1"]),
              hook("Wax is heated to about 80 degrees Celsius before it becomes a crayon.", "counterintuitive-fact", ["T1.1"]),
              // Unsupported: the research never says 999.
              hook("Crayon wax is heated to 999 degrees.", "material-contrast", ["T1.1"]),
              // Cites a claim that doesn't exist.
              hook("Every crayon is checked by hand.", "hidden-difficulty", ["T9.9"]),
              hook("A box of crayons starts as melted wax.", "unexpected-transformation", ["T1.1", "T4.1"]),
            ],
          });
        }
        case "hook_review": {
          const lines = [...user.matchAll(/^\[(\d+)\] "(.*)" \(/gm)].map((m) => m[2]);
          return out({
            reviews: lines.map((line, index) => {
              const v = index === 0 ? 5 : 3;
              const supported = !line.includes("999");
              return { index, clarity: v, curiosity: v, specificity: v, connection: v, factualSupport: supported ? v : 1, visualPotential: v, naturalLanguage: v, supported, unsupportedDetail: supported ? "" : "999 degrees is not in the research.", note: "ok" };
            }),
          });
        }
        case "process_attention": {
          const narration = between(user, "SCRIPT\n");
          const quote = narration.split(" ").slice(2, 8).join(" ");
          return out({
            issues:
              opts.attention === "significant-always"
                ? [{ category: "filler", severity: "blocking", kind: "contradiction", location: "Sentence 1", evidence: quote, problem: "Repeats itself.", repair: "Cut the repeat." }]
                : [],
          });
        }
        case "topic_ideas": {
          const n = Number(/Propose exactly (\d+)/.exec(user)?.[1] ?? 9);
          const refs = [...user.matchAll(/^- (\S+) · (.+?) · /gm)].map((m) => ({ id: m[1], product: m[2] }));
          const bad = opts.topicBadReferenceOnce && (calls.topic_ideas ?? 0) === 1;
          return out({
            ideas: Array.from({ length: n }, (_, i) => {
              // Idea 0 repeats the first library product; the rest are new.
              const [product, category] = i === 0 && refs[0] ? [refs[0].product, "footwear"] : TOPIC_PRODUCTS[i % TOPIC_PRODUCTS.length];
              const strategy = (["EVIDENCE_BACKED", "ADJACENT", "EXPLORATORY"] as const)[i % 3];
              return {
                product,
                category,
                title: `How ${product} Are Made`,
                concept: `How ${product.toLowerCase()} are made, quill${i}.`,
                premise: `How ${product.toLowerCase()} are made in a factory, zest${i}.`,
                arc: "Raw material. Shaping. Packing.",
                strategy,
                referenceIds: strategy === "EXPLORATORY" || !refs[0] ? [] : bad && i === 1 ? ["not-a-ref"] : [refs[0].id],
                comparableReason: strategy === "EXPLORATORY" ? "" : "Same moulding operation.",
                whyViewers: "Everyone owns one.",
                featuredStage: "Moulding",
                curiosityAngle: `How is ${product.toLowerCase()} shaped?`,
                visualPayoff: "It pops out of the mould.",
                researchFeasibility: "Well documented.",
                visualFeasibility: "Easy to draw.",
              };
            }),
          });
        }
        case "topic_evaluation": {
          const indexes = [...user.matchAll(/^\[(\d+)\] /gm)].map((m) => Number(m[1]));
          const r = (score: number) => ({ score, note: "n" });
          return out({ evaluations: indexes.map((index) => ({ index, visual: r(8 - (index % 4)), familiarity: r(7), surprise: r(6), researchAvailability: r(9), visualFeasibility: r(8) })) });
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
