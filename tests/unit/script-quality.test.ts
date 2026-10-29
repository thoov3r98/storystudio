import { describe, expect, it } from "vitest";
import type { QualityRecord, RecordedIssue } from "@/lib/schemas/quality";
import { evidenceFound, needsRevision, qualityStatus, recordIssues, withDismissal } from "@/lib/process/review";
import { narrationLengthIssues } from "@/lib/process/script";
import { groupOutcomes, type ScriptRow, summarize } from "@/lib/process/metrics";
import { validateProcessPlan, type ProcessPlan, type ResearchNotes } from "@/lib/schemas/process";
import { estimateEpisodeCost } from "@/lib/costs/estimate";
import { DEFAULT_PRICING } from "@/lib/costs/pricing";
import { scriptModels } from "@/lib/settings";

describe("evidence and issue policy", () => {
  const script = "The wax is heated to about 120 degrees, then pumped into the moulds.";

  it("finds real quotes, ignoring case and punctuation, and accepts a four-word run", () => {
    expect(evidenceFound("the wax is heated to about 120 degrees", script)).toBe(true);
    expect(evidenceFound("It is heated to about 120 degrees, then cooled", script)).toBe(true);
    expect(evidenceFound("The wax is poured by hand", script)).toBe(false);
    expect(evidenceFound("", script)).toBe(false);
  });

  it("never lets a creative concern block, and downgrades issues whose quote isn't in the script", () => {
    const base = { category: "unsupported-claim" as const, location: "line 1", problem: "p", repair: "r" };
    const [concern, invented, real] = recordIssues(
      [
        { ...base, severity: "blocking", kind: "creative-concern", evidence: "pumped into the moulds" },
        { ...base, severity: "blocking", kind: "contradiction", evidence: "the wax is poured by hand" },
        { ...base, severity: "blocking", kind: "contradiction", evidence: "heated to about 120 degrees" },
      ],
      { stage: "script", source: script, prefix: "S1." },
    );
    expect(concern).toMatchObject({ severity: "significant", verified: true, id: "S1.1" });
    expect(invented).toMatchObject({ severity: "minor", verified: false });
    expect(real).toMatchObject({ severity: "blocking", verified: true, id: "S1.3" });
  });

  const issue = (severity: RecordedIssue["severity"], id = "S1.1"): RecordedIssue => ({
    id,
    severity,
    category: "unsupported-claim",
    kind: "contradiction",
    location: "x",
    evidence: "e",
    problem: "p",
    repair: "r",
    stage: "script",
    verified: true,
  });

  it("revises for blocking or significant issues only, never for minor notes", () => {
    expect(needsRevision([issue("minor")])).toBe(false);
    expect(needsRevision([issue("significant")])).toBe(true);
  });

  it("decides the gate: blocking blocks, open significant needs attention", () => {
    expect(qualityStatus({ issues: [issue("minor")] })).toBe("passed");
    expect(qualityStatus({ issues: [issue("significant")] })).toBe("needs-attention");
    expect(qualityStatus({ issues: [issue("blocking"), issue("significant", "S1.2")] })).toBe("blocked");
    expect(qualityStatus({ issues: [issue("blocking")], dismissed: ["S1.1"] })).toBe("passed");
  });

  it("records a dismissal once, and only for issues that exist", () => {
    const q = { issues: [issue("blocking")], dismissed: [], status: "blocked" } as unknown as QualityRecord;
    const once = withDismissal(q, "S1.1", "the research says so");
    expect(once.status).toBe("passed");
    expect(withDismissal(once, "S1.1", "again").dismissed).toHaveLength(1);
    expect(withDismissal(q, "nope", "").dismissed).toHaveLength(0);
  });

  it("checks the narration fits the video's length", () => {
    const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(" ");
    expect(narrationLengthIssues(words(170), { durationSec: 75, wordsPerSecond: 2.5 })).toEqual([]);
    expect(narrationLengthIssues("Too short.", { durationSec: 75, wordsPerSecond: 2.5 }).join(" ")).toMatch(/must be \d+–\d+ words/);
  });
});

describe("models and cost", () => {
  const models = { main: "gpt-5.5", fast: "gpt-5.4-mini", image: "img", speech: "tts" };
  it("checks with the strongest model (or a configured checker) except at Draft", () => {
    expect(scriptModels("STANDARD", models)).toEqual({ writer: "gpt-5.5", reviewer: "gpt-5.5" });
    expect(scriptModels("STANDARD", { ...models, reviewer: "other-model" }).reviewer).toBe("other-model");
    expect(scriptModels("STANDARD", { ...models, reviewer: "  " }).reviewer).toBe("gpt-5.5");
    expect(scriptModels("DRAFT", models)).toEqual({ writer: "gpt-5.4-mini", reviewer: "gpt-5.4-mini" });
  });

  it("prices research once and every part's script together, with media for one part", () => {
    const one = estimateEpisodeCost(DEFAULT_PRICING, models, { durationSec: 75, quality: "STANDARD" });
    const four = estimateEpisodeCost(DEFAULT_PRICING, models, { durationSec: 75, quality: "STANDARD", parts: 4 });
    expect(four.text).toBeGreaterThan(one.text * 4);
    expect(four.images).toBe(one.images);
    const cheaperChecker = estimateEpisodeCost(DEFAULT_PRICING, { ...models, reviewer: "gpt-5.4-mini" }, { durationSec: 75, quality: "STANDARD" });
    expect(cheaperChecker.text).toBeLessThan(one.text);
  });
});

describe("quality measures", () => {
  const q = (over: Partial<QualityRecord["metrics"]>, status: QualityRecord["status"] = "passed"): QualityRecord =>
    ({
      status,
      issues: [],
      dismissed: [],
      override: null,
      metrics: { firstPass: true, scriptRevisions: 0, blockingFound: 0, significantFound: 0, unverifiedIssues: 0, durationMs: 120000, textCostUsd: 0.5, ...over },
    }) as unknown as QualityRecord;
  const row = (over: Partial<ScriptRow>): ScriptRow => ({ quality: q({}), story: "How Crayons Are Made", approved: false, rejected: false, humanRating: null, performance: null, ...over });

  it("summarises first-pass rate, revisions, approvals and ratings", () => {
    const s = summarize([
      row({ approved: true, humanRating: 4 }),
      row({ quality: q({ firstPass: false, scriptRevisions: 2, blockingFound: 1 }, "needs-attention"), rejected: true, humanRating: 2 }),
    ]);
    expect(s).toMatchObject({ scripts: 2, firstPassPct: 50, avgRevisionCycles: 1, blockingPerScript: 0.5, approvalPct: 50, avgHumanRating: 3, verdicts: { passed: 1, needsAttention: 1, blocked: 0 } });
  });

  it("groups outcomes with platform numbers by product", () => {
    const g = groupOutcomes([row({ performance: { views: 1000, completionRate: 40, earlyRetention: 70, rewatchRate: 5 } }), row({ story: "How Soap Is Made" })], (r) => r.story);
    expect(g.find((x) => x.name === "How Crayons Are Made")).toMatchObject({ scripts: 1, published: 1, avgViews: 1000, avgCompletion: 40 });
    expect(g.find((x) => x.name === "How Soap Is Made")).toMatchObject({ published: 0, avgViews: null });
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
