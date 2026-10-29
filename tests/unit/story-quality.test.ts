import { describe, expect, it } from "vitest";
import { type Plot, PlotSchema, type QualityRecord, type RecordedIssue } from "@/lib/schemas/story-plan";
import { partBeatRange, plotBeatRange, validatePlot } from "@/lib/story/plot";
import { partBrief } from "@/lib/ai/story-prompts";
import { evidenceFound, genericHookPhrase, needsRevision, qualityStatus, recordIssues, withDismissal } from "@/lib/story/review";
import { BUILT_IN_REFERENCES, type ReferenceStory, selectReferences } from "@/lib/story/references";
import { narrationIssues } from "@/lib/story/compose";
import { groupOutcomes, type ScriptRow, summarize } from "@/lib/story/metrics";
import { validateProcessPlan, type ProcessPlan, type ResearchNotes } from "@/lib/schemas/process";
import { estimateEpisodeCost } from "@/lib/costs/estimate";
import { DEFAULT_PRICING } from "@/lib/costs/pricing";
import { scriptModels } from "@/lib/settings";
import { FAKE_PLOT, fakeStoryPlot } from "../integration/fakes";
import { BENCH_CASES } from "../story-bench/cases";
import { BENCH_PREMISES } from "../story-bench/premises";

const plot = (): Plot => PlotSchema.parse(structuredClone(FAKE_PLOT));
const opts = { durationSec: 75 };

describe("plot structure checks", () => {
  it("accepts a causal plot with setups planted before they pay off", () => {
    expect(validatePlot(plot(), opts)).toEqual([]);
  });

  it("flags a resolution that relies on something introduced in the final beat (a convenience)", () => {
    const p = plot();
    p.setups.push({ id: "S2", what: "A screwdriver in her apron", plantedInBeat: 5 });
    p.resolution.enabledBy = ["S2"];
    expect(validatePlot(p, opts).join(" ")).toMatch(/introduced in the final beat/);
  });

  it("flags beats that use a setup before the viewer learns of it", () => {
    const p = plot();
    p.setups[0].plantedInBeat = 4;
    expect(validatePlot(p, opts).join(" ")).toMatch(/Beat 3 relies on S1.*only learns of it in beat 4/);
  });

  it("flags uncaused beats, references to the future and unknown ids", () => {
    const p = plot();
    p.beats[1].enabledBy = [];
    p.beats[2].enabledBy = ["B4", "S9", "R7", "because"];
    const issues = validatePlot(p, opts).join(" | ");
    expect(issues).toMatch(/Beat 2 has no cause/);
    expect(issues).toMatch(/B4, which has not happened yet/);
    expect(issues).toMatch(/S9, which is not in setups/);
    expect(issues).toMatch(/R7, which is not in worldRules/);
    expect(issues).toMatch(/"because" is not a beat/);
  });

  it("fits the plot to the length: fewer beats for shorter episodes, and no 'and then' chains", () => {
    expect(plotBeatRange(45)).toEqual([3, 5]);
    expect(plotBeatRange(90)).toEqual([5, 8]);
    const p = plot();
    p.beats.push({ ...p.beats[4], n: 6, enabledBy: ["B5"] });
    expect(validatePlot(p, { durationSec: 45 }).join(" ")).toMatch(/3–5 major beats .* \(you have 6\)/);
    p.beats.forEach((b, i) => (b.link = i === 0 ? "start" : "meanwhile"));
    expect(validatePlot(p, opts).join(" ")).toMatch(/"meanwhile" at most once/);
  });
});

describe("multi-part plans", () => {
  const story = (): Plot => PlotSchema.parse(structuredClone(fakeStoryPlot(4)));
  it("accepts one story split into four parts with room in each", () => {
    expect(validatePlot(story(), { durationSec: 75, parts: 4 })).toEqual([]);
    expect(partBeatRange(75, 4)).toEqual([2, 4]);
  });

  it("requires every part to have a real cliffhanger, a small payoff and (after Part 1) an orienting line", () => {
    const p = story();
    p.parts[1].cliffhanger = "";
    p.parts[2].newViewerLine = "";
    p.parts[0].smallPayoff = " ";
    const issues = validatePlot(p, { durationSec: 75, parts: 4 }).join(" | ");
    expect(issues).toMatch(/Part 2 needs a cliffhanger/);
    expect(issues).toMatch(/Part 3 needs a newViewerLine/);
    expect(issues).toMatch(/Part 1 needs a smallPayoff/);
  });

  it("refuses crammed parts, gaps and the wrong number of parts", () => {
    const p = story();
    p.parts[0].beats = [1, 2, 3, 4, 5];
    p.parts[1].beats = [7];
    const issues = validatePlot(p, { durationSec: 75, parts: 4 }).join(" ");
    expect(issues).toMatch(/Part 1 has 5 beats; give each video 2–4/);
    expect(issues).toMatch(/cover every beat exactly once/);
    expect(validatePlot(story(), { durationSec: 75, parts: 3 }).join(" ")).toMatch(/exactly 3 parts/);
  });

  it("accepts any part count inside a channel's range, and names the range when it is wrong", () => {
    expect(validatePlot(story(), { durationSec: 75, parts: [3, 5] })).toEqual([]);
    expect(validatePlot(story(), { durationSec: 75, parts: [2, 3] }).join(" ")).toMatch(/into 2–3 parts \(you have 4\)/);
  });

  it("tells each part what it covers and what came before", () => {
    const brief = partBrief(story(), 2, ["Part one text."]);
    expect(brief).toContain("THIS IS PART 2 OF 4");
    expect(brief).toContain("It tells beats 4, 5, 6 only");
    expect(brief).toContain("Turn at the end of part 2");
    expect(brief).toContain("Part 1: Part one text.");
    expect(partBrief(plot(), 1, [])).toBe("");
  });

  it("prices all parts' scripts together and media for one part", () => {
    const models = { main: "gpt-5.5", fast: "gpt-5.4-mini", image: "img", speech: "tts" };
    const one = estimateEpisodeCost(DEFAULT_PRICING, models, { durationSec: 75, quality: "STANDARD" });
    const four = estimateEpisodeCost(DEFAULT_PRICING, models, { durationSec: 75, quality: "STANDARD", parts: 4 });
    expect(four.text).toBeGreaterThan(one.text * 2.5);
    expect(four.text).toBeLessThan(one.text * 4);
    expect(four.images).toBe(one.images);
  });
});

describe("evidence and issue policy", () => {
  const story = "Kenny typed in 7-4-1-9 without thinking, and the hatch hissed open.";

  it("finds real quotes, ignoring case and punctuation, and accepts a four-word run", () => {
    expect(evidenceFound("kenny typed in 7 4 1 9", story)).toBe(true);
    expect(evidenceFound("He typed 7-4-1-9 without thinking, then smiled", story)).toBe(true);
    expect(evidenceFound("Kenny remembered the code from his father", story)).toBe(false);
    expect(evidenceFound("", story)).toBe(false);
  });

  it("never lets a creative concern block, and downgrades issues whose quote isn't in the story", () => {
    const base = { category: "causal-gap" as const, location: "Beat 3", problem: "p", repair: "r" };
    const [concern, invented, real] = recordIssues(
      [
        { ...base, severity: "blocking", kind: "creative-concern", evidence: "the hatch hissed open" },
        { ...base, severity: "blocking", kind: "contradiction", evidence: "Kenny found the code in a notebook" },
        { ...base, severity: "blocking", kind: "contradiction", evidence: "typed in 7-4-1-9 without thinking" },
      ],
      { stage: "script", source: story, prefix: "S1." },
    );
    expect(concern).toMatchObject({ severity: "significant", verified: true, id: "S1.1" });
    expect(invented).toMatchObject({ severity: "minor", verified: false });
    expect(real).toMatchObject({ severity: "blocking", verified: true, id: "S1.3" });
  });

  const issue = (severity: RecordedIssue["severity"], id = "S1.1"): RecordedIssue => ({
    id,
    severity,
    category: "knowledge",
    kind: "contradiction",
    location: "x",
    evidence: "e",
    problem: "p",
    repair: "r",
    stage: "script",
    verified: true,
  });
  const note = { area: "hook" as const, evidence: "e", problem: "p", fix: "f" };

  it("revises for blocking, significant or must-fix items only, never for minor notes", () => {
    expect(needsRevision([issue("minor")], [])).toBe(false);
    expect(needsRevision([issue("significant")], [])).toBe(true);
    expect(needsRevision([], [note])).toBe(true);
  });

  it("decides the gate: blocking blocks, open significant or must-fix needs attention", () => {
    expect(qualityStatus({ issues: [issue("minor")], mustFix: [] })).toBe("passed");
    expect(qualityStatus({ issues: [issue("significant")], mustFix: [] })).toBe("needs-attention");
    expect(qualityStatus({ issues: [], mustFix: [note] })).toBe("needs-attention");
    expect(qualityStatus({ issues: [issue("blocking"), issue("significant", "S1.2")], mustFix: [] })).toBe("blocked");
    expect(qualityStatus({ issues: [issue("blocking")], mustFix: [], dismissed: ["S1.1"] })).toBe("passed");
  });

  it("records a dismissal once, and only for issues that exist", () => {
    const q = { issues: [issue("blocking")], mustFix: [], dismissed: [], status: "blocked" } as unknown as QualityRecord;
    const once = withDismissal(q, "S1.1", "explained in scene 2");
    expect(once.status).toBe("passed");
    expect(withDismissal(once, "S1.1", "again").dismissed).toHaveLength(1);
    expect(withDismissal(q, "nope", "").dismissed).toHaveLength(0);
  });
});

describe("hooks and narration", () => {
  it("rejects generic hooks and accepts specific ones", () => {
    expect(genericHookPhrase("Kenny woke up and knew something was terribly wrong.")).toBe("knew something was terribly wrong");
    expect(genericHookPhrase("Little did she know the lift would stop.")).toBe("little did");
    expect(genericHookPhrase("Kenny woke up to forty-seven missed calls. Every single one was from his own number.")).toBeNull();
  });

  it("requires the chosen hook first, every beat told, and a length that fits", () => {
    const p = plot();
    const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(" ");
    const good = { storyNarration: `The carousel stops. ${words(170)}.`, beatCoverage: p.beats.map((b) => ({ beat: b.n })) };
    const o = { durationSec: 75, wordsPerSecond: 2.5, plot: p, hook: "The carousel stops." };
    expect(narrationIssues(good, o)).toEqual([]);
    expect(narrationIssues({ ...good, beatCoverage: good.beatCoverage.slice(0, 3) }, o).join(" ")).toMatch(/missing beat\(s\) 4, 5/);
    expect(narrationIssues(good, { ...o, hook: "Your bag is gone." }).join(" ")).toMatch(/Open with the chosen hook/);
    expect(narrationIssues({ ...good, storyNarration: "The carousel stops. Too short." }, o).join(" ")).toMatch(/must be \d+–\d+ words/);
  });
});

describe("reference stories", () => {
  const mine: ReferenceStory = { ...BUILT_IN_REFERENCES[0], id: "mine", source: "producer", title: "My survival script" };

  it("picks the closest examples by story type, then hook and ending, preferring the producer's own", () => {
    const picked = selectReferences([...BUILT_IN_REFERENCES, mine], { archetype: "survival", hookStyle: "immediate-danger" });
    expect(picked.map((r) => r.id)).toEqual(["mine", "builtin-last-bus"]);
    expect(selectReferences(BUILT_IN_REFERENCES, { archetype: "mystery" })[0].id).toBe("builtin-car-moved");
  });

  it("injects nothing when nothing matches, and never more than the limit", () => {
    expect(selectReferences(BUILT_IN_REFERENCES, {})).toEqual([]);
    expect(selectReferences([], { archetype: "comedy" })).toEqual([]);
    expect(selectReferences(BUILT_IN_REFERENCES, { archetype: "comedy", endingType: "cliffhanger" }, 2)).toHaveLength(2);
  });

  it("built-in examples are labelled as original examples and cover every main archetype", () => {
    expect(BUILT_IN_REFERENCES.every((r) => r.title.includes("(original example)"))).toBe(true);
    expect(new Set(BUILT_IN_REFERENCES.map((r) => r.archetype))).toEqual(new Set(["survival", "mystery", "speculative", "comedy", "suspense", "everyday"]));
  });
});

describe("models and cost", () => {
  const models = { main: "gpt-5.5", fast: "gpt-5.4-mini", image: "img", speech: "tts" };
  it("checks with the strongest model (or a configured reviewer) except at Draft", () => {
    expect(scriptModels("STANDARD", models)).toEqual({ writer: "gpt-5.5", reviewer: "gpt-5.5" });
    expect(scriptModels("STANDARD", { ...models, reviewer: "other-model" }).reviewer).toBe("other-model");
    expect(scriptModels("STANDARD", { ...models, reviewer: "  " }).reviewer).toBe("gpt-5.5");
    expect(scriptModels("DRAFT", models)).toEqual({ writer: "gpt-5.4-mini", reviewer: "gpt-5.4-mini" });
  });

  it("estimates script writing with every planning and checking step", () => {
    const e = estimateEpisodeCost(DEFAULT_PRICING, models, { durationSec: 75, quality: "STANDARD" });
    expect(e.text).toBeGreaterThan(0.4);
    expect(e.text).toBeLessThan(1.2);
    const cheaperReviewer = estimateEpisodeCost(DEFAULT_PRICING, { ...models, reviewer: "gpt-5.4-mini" }, { durationSec: 75, quality: "STANDARD" });
    expect(cheaperReviewer.text).toBeLessThan(e.text);
  });
});

describe("quality measures", () => {
  const q = (over: Partial<QualityRecord["metrics"]>, status: QualityRecord["status"] = "passed"): QualityRecord =>
    ({
      status,
      issues: [],
      mustFix: [],
      dismissed: [],
      override: null,
      hooks: null,
      metrics: { firstPass: true, plotRepairs: 0, scriptRevisions: 0, blockingFound: 0, significantFound: 0, unverifiedIssues: 0, durationMs: 120000, textCostUsd: 0.5, ...over },
    }) as unknown as QualityRecord;
  const row = (over: Partial<ScriptRow>): ScriptRow => ({ quality: q({}), archetype: "survival", approved: false, rejected: false, humanRating: null, hookStyle: null, performance: null, ...over });

  it("summarises first-pass rate, revisions, approvals and ratings", () => {
    const s = summarize([
      row({ approved: true, humanRating: 4 }),
      row({ quality: q({ firstPass: false, scriptRevisions: 2, blockingFound: 1 }, "needs-attention"), rejected: true, humanRating: 2 }),
    ]);
    expect(s).toMatchObject({ scripts: 2, firstPassPct: 50, avgRevisionCycles: 1, blockingPerScript: 0.5, approvalPct: 50, avgHumanRating: 3, verdicts: { passed: 1, needsAttention: 1, blocked: 0 } });
  });

  it("groups outcomes with platform numbers by story type", () => {
    const g = groupOutcomes(
      [row({ performance: { views: 1000, completionRate: 40, earlyRetention: 70, rewatchRate: 5 } }), row({ archetype: "mystery" })],
      (r) => r.archetype,
    );
    expect(g.find((x) => x.name === "survival")).toMatchObject({ scripts: 1, published: 1, avgViews: 1000, avgCompletion: 40 });
    expect(g.find((x) => x.name === "mystery")).toMatchObject({ published: 0, avgViews: null });
  });
});

describe("benchmark set", () => {
  it("is stable and well-formed: unique ids, every seeded hole names what counts as catching it", () => {
    const ids = BENCH_CASES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(BENCH_CASES.filter((c) => c.kind === "flawed").every((c) => c.expect.length > 0)).toBe(true);
    expect(BENCH_CASES.filter((c) => c.kind === "sound").every((c) => c.expect.length === 0)).toBe(true);
    expect(BENCH_CASES.filter((c) => c.kind === "flawed").length).toBeGreaterThanOrEqual(10);
    expect(BENCH_CASES.filter((c) => c.kind === "sound").length).toBeGreaterThanOrEqual(5);
    expect(new Set(BENCH_PREMISES.map((p) => p.id)).size).toBe(BENCH_PREMISES.length);
  });
});

describe("process explainer plans", () => {
  const research: ResearchNotes = {
    product: "Crayons",
    overview: "o",
    mainRoute: "m",
    stages: ["Melt", "Mould", "Wrap", "Box"].map((name, i) => ({ id: `T${i + 1}`, name, steps: [{ what: name, details: "", sources: ["1"] }] })),
    uncertain: [],
  };
  const plan = (groups: string[][]): ProcessPlan => ({
    parts: groups.map((stages, i) => ({ part: i + 1, title: `P${i + 1}`, stages, opening: "Crayons.", endsAt: "next" })),
  });
  it("accepts every stage told once, in factory order, within the part range", () => {
    expect(validateProcessPlan(plan([["T1"], ["T2"], ["T3", "T4"]]), research, [3, 5])).toEqual([]);
  });
  it("refuses skipped or reordered stages and too few parts", () => {
    const issues = validateProcessPlan(plan([["T2"], ["T1", "T3"]]), research, [3, 5]).join(" ");
    expect(issues).toMatch(/into 3–5 parts/);
    expect(issues).toMatch(/every stage exactly once, in factory order: T1, T2, T3, T4/);
  });
});
