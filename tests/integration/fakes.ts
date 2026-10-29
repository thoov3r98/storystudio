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
  /** Plot logic audit: a blocking hole that a repair fixes, or one that never goes away. */
  plotAudit?: "pass" | "blocking-once" | "blocking-always";
  /** Script logic audit: a significant issue fixed by one revision, a blocking one that persists, or a series contradiction. */
  scriptAudit?: "pass" | "significant-once" | "blocking-always" | "series-conflict";
  /** Editorial review: a must-fix note on the first read, or on every read. */
  editorial?: "ready" | "must-fix-once" | "must-fix-always";
};

/** A valid five-beat causal plot (setups planted before use, every beat caused). */
export const FAKE_PLOT = {
  archetype: "survival",
  dramaticQuestion: "Will the traveller get the bag back before the flight?",
  heroGoal: "Get the bag back",
  openingState: "In the arrivals hall after a ten-hour flight, holding a baggage tag.",
  worldRules: [{ id: "R1", rule: "Bags with tags can be tracked at the service desk." }],
  setups: [{ id: "S1", what: "The baggage tag in their pocket", plantedInBeat: 0 }],
  beats: [
    { n: 1, link: "start", event: "The carousel stops and the bag never comes.", cause: "Opening.", enabledBy: [], heroWants: "Their bag", heroKnows: "Nothing yet", state: "Arrivals hall", changes: "The bag is missing" },
    { n: 2, link: "but", event: "The service desk queue is an hour long.", cause: "A full flight landed.", enabledBy: ["B1"], heroWants: "Help", heroKnows: "The bag is missing", state: "In the queue", changes: "Time is running out" },
    { n: 3, link: "therefore", event: "They read the tag number to a gate agent instead.", cause: "They have the tag.", enabledBy: ["B2", "S1", "R1"], heroWants: "To track it", heroKnows: "The tag can be tracked", state: "At a gate", changes: "The bag is located" },
    { n: 4, link: "but", event: "The bag is on another plane.", cause: "Mis-sorted.", enabledBy: ["B3"], heroWants: "The bag", heroKnows: "Where it is", state: "At the gate", changes: "A new problem" },
    { n: 5, link: "therefore", event: "They rebook onto that plane.", cause: "It goes home too.", enabledBy: ["B4"], heroWants: "To go home with it", heroKnows: "Its flight", state: "Boarding", changes: "They follow the bag" },
  ],
  resolution: { what: "They board the plane their bag is on.", enabledBy: ["B5", "S1"], endingType: "irony" },
  deliberateMysteries: [],
};

const AUDIT_ISSUE = (severity: string, evidence: string, category = "causal-gap") => ({
  category,
  severity,
  kind: "contradiction",
  location: "Beat 3",
  evidence,
  problem: "It isn't clear why this happens.",
  repair: "Show the cause earlier.",
});

const EDITORIAL = (mustFix: boolean, narration: string) => {
  const quote = narration.split(" ").slice(0, 5).join(" ");
  const rate = (criterion: string) => ({ criterion, rating: "strong", evidence: quote, note: "n" });
  return {
    narrative: ["premise", "dramatic-question", "every-beat-matters", "earned-escalation", "believable-reactions", "economy", "freshness", "ending", "worth-the-time"].map(rate),
    retention: ["first-line", "instant-clarity", "curiosity-gap", "starts-late", "hook-delivered", "steady-change", "payoff"].map(rate),
    mustFix: mustFix ? [{ area: "narrative", evidence: quote, problem: "The opening drags.", fix: "Cut to the moment the bag is missing." }] : [],
    suggestions: [],
  };
};

const between = (text: string, start: string, end?: string) => {
  const a = text.indexOf(start);
  if (a < 0) return "";
  const from = a + start.length;
  const b = end ? text.indexOf(end, from) : -1;
  return text.slice(from, b < 0 ? undefined : b).trim();
};

/** Issue ids listed in a revision or repair prompt ("- S1.1: ..."). */
const issueIds = (user: string) => [...user.matchAll(/^- ([A-Z]\d+\.\d+|E\d+): /gm)].map((m) => m[1]);

/** Cuts narration into shots the way makeDraft does: the hook travels with its first sentence. */
function cutScenes(narration: string, hero: string) {
  const sentences = narration.split(/(?<=\.)\s+/);
  const shots = sentences.length > 12 ? [`${sentences[0]} ${sentences[1]}`, ...sentences.slice(2)] : sentences;
  return shots.map((n, i) => ({
    sceneNumber: i + 1,
    narration: n,
    imagePrompt: `A stick figure in scene ${i + 1}`,
    composition: "wide shot",
    continuity: `Still in the terminal, scene ${i + 1}`,
    characters: i === 4 ? [] : [hero],
    objects: ["suitcase"],
    motionPreset: "slow-zoom-in",
  }));
}

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

export function fakeText(opts: FakeTextOptions = {}): StructuredTextClient & { calls: Record<string, number>; prompts: Record<string, string[]>; models: Record<string, string> } {
  const calls: Record<string, number> = {};
  const prompts: Record<string, string[]> = {};
  const models: Record<string, string> = {};
  let conceptCounter = 0;
  return {
    calls,
    prompts,
    models,
    async generate({ schemaName, user, model }) {
      calls[schemaName] = (calls[schemaName] ?? 0) + 1;
      models[schemaName] = model;
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
                openingSituation: `You notice ${subject}`,
                seriesPotential: "Many parts",
                archetype: "mystery",
                dramaticQuestion: `What is behind the ${subject}?`,
                beatSketch: "It starts. It turns. It pays off.",
              };
            }),
          });
        }
        case "concept_evaluation": {
          const n = (user.match(/^\[\d+\]/gm) ?? []).length;
          return out({ evaluations: Array.from({ length: n }, (_, i) => ({ conceptIndex: i, scores: scores(4 + ((i * 3) % 6)), summary: "ok" })) });
        }
        case "plot_candidates":
          return out({ plots: [FAKE_PLOT, { ...FAKE_PLOT, dramaticQuestion: "Second plot" }] });
        case "plot_pick":
          return out({ reviews: [0, 1].map((index) => ({ index, strengths: "s", weaknesses: "w" })), chosenIndex: 1, reason: "Clearer cause and effect." });
        case "plot_audit": {
          const n = calls.plot_audit;
          const fail = opts.plotAudit === "blocking-always" || (opts.plotAudit === "blocking-once" && n === 1);
          return out({
            intendedUnknowns: [],
            issues: fail ? [AUDIT_ISSUE("blocking", "They read the tag number to a gate agent instead", "knowledge")] : [],
            previousIssues: user.includes("EARLIER ISSUES") ? issueIds(user).map((id) => ({ id, resolved: !fail, note: "" })) : [],
          });
        }
        case "plot_repair": {
          const plot = JSON.parse(between(user, "CURRENT PLOT", "Return a diagnosis"));
          const ids = issueIds(user);
          return out({ diagnosis: ids.map((issueId) => ({ issueId, rootBeat: 2, rootCause: "c" })), plot, changeLog: ids.map((issueId) => ({ issueId, change: "Planted the cause in beat 2." })) });
        }
        case "hook_candidates":
          return out({
            dramaticQuestion: "Will they get the bag?",
            strongestMoment: "The carousel stops",
            candidates: [
              { style: "relatable-problem", text: "You land after ten hours.", promise: "A travel problem", paidOffIn: "B1" },
              { style: "specific-mystery", text: "Your bag is on a plane you are not.", promise: "Where the bag went", paidOffIn: "B4" },
              { style: "immediate-danger", text: "The carousel stops.", promise: "Trouble", paidOffIn: "B1" },
              { style: "contradiction", text: "The tag says Lisbon.", promise: "A mix-up", paidOffIn: "B3" },
            ],
          });
        case "hook_pick":
          return out({
            reviews: [0, 1, 2, 3].map((index) => ({ index, clarity: "strong", curiosity: "strong", specificity: "strong", deliveredByPlot: true, note: "n" })),
            chosenIndex: 0,
            hook: "You land after ten hours.",
            promise: "A travel problem you'll solve",
          });
        case "story_narration": {
          const hook = /CHOSEN HOOK \(open with exactly this\): (.+)/.exec(user)?.[1] ?? "You land after ten hours.";
          const part = Number(/^Part: (\d+)/m.exec(user)?.[1] ?? 1);
          const hero = /NARRATOR AND HERO: (.+?) —/.exec(user)?.[1];
          const d = makeDraft(hook, part, 12, hero);
          return out({
            title: d.title,
            storyNarration: d.storyNarration,
            summary: d.summary,
            keyReveals: d.keyReveals,
            unresolvedQuestions: d.unresolvedQuestions,
            beatCoverage: FAKE_PLOT.beats.map((b) => ({ beat: b.n, opensWith: "x" })),
            planChanges: [],
          });
        }
        case "script_audit": {
          const narration = between(user, "NARRATION\n");
          const quote = narration.split(" ").slice(6, 12).join(" ");
          const n = calls.script_audit;
          const issues =
            opts.scriptAudit === "blocking-always"
              ? [AUDIT_ISSUE("blocking", quote)]
              : opts.scriptAudit === "series-conflict" && user.includes("SERIES SO FAR")
                ? [AUDIT_ISSUE("blocking", quote, "series-continuity")]
                : opts.scriptAudit === "significant-once" && n === 1
                  ? [AUDIT_ISSUE("significant", quote)]
                  : [];
          return out({ intendedUnknowns: [], issues, previousIssues: user.includes("EARLIER ISSUES") ? issueIds(user).map((id) => ({ id, resolved: issues.length === 0, note: "" })) : [] });
        }
        case "editorial_review": {
          const narration = between(user, "SCRIPT\n");
          const mustFix = opts.editorial === "must-fix-always" || (opts.editorial === "must-fix-once" && calls.editorial_review === 1);
          return out(EDITORIAL(mustFix, narration));
        }
        case "script_revision": {
          const plot = JSON.parse(between(user, "CURRENT PLOT", "CURRENT NARRATION"));
          const narration = between(user, "CURRENT NARRATION");
          const sentences = narration.split(/(?<=\.)\s+/);
          sentences[2] = sentences[2].replace(/\.$/, " revised.");
          const ids = issueIds(user);
          return out({
            diagnosis: ids.map((issueId) => ({ issueId, rootBeat: 2, rootCause: "c" })),
            plot,
            title: "Revised episode",
            storyNarration: sentences.join(" "),
            summary: "Revised summary.",
            keyReveals: ["Reveal"],
            unresolvedQuestions: ["Question"],
            beatCoverage: plot.beats.map((b: { n: number }) => ({ beat: b.n, opensWith: "x" })),
            changeLog: ids.map((issueId) => ({ issueId, change: "Fixed at the root." })),
          });
        }
        case "scene_breakdown": {
          const narration = between(user, "FINAL NARRATION", "\u0000").replace(/^— ".*"\n/, "");
          const part = Number(/^Part: (\d+)/m.exec(user)?.[1] ?? 1);
          const hero = /NARRATOR AND HERO: (.+?) —/.exec(user)?.[1] ?? "You";
          const d = makeDraft("x", part, 12, hero);
          return out({ visualState: d.visualState, scenes: cutScenes(narration, hero), bibleUpdate: d.bibleUpdate });
        }
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
