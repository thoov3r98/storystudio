import { describe, expect, it } from "vitest";
import { hookOpeningIssues, hookSupportFlags, hookTotal, numbersIn, recommendHook, researchClaims } from "@/lib/schemas/storytelling";
import { recordIssues } from "@/lib/process/review";
import { researchText } from "@/lib/ai/process-prompts";

const research = {
  product: "Razor blades",
  overview: "o",
  mainRoute: "",
  uncertain: [],
  stages: [
    { id: "T1", name: "Rolling", steps: [{ what: "Steel is rolled into a strip.", details: "about 0.1 mm thick", sources: ["1"] }] },
    {
      id: "T2",
      name: "Hardening",
      steps: [
        { what: "The strip is heated and quenched.", details: "", sources: ["2"] },
        { what: "It is ground to the sharpest edge the line makes.", details: "", sources: ["2"] },
      ],
    },
  ],
};

describe("research claims", () => {
  it("numbers every step and shows the ids to the writer", () => {
    expect([...researchClaims(research).keys()]).toEqual(["T1.1", "T2.1", "T2.2"]);
    expect(researchText(research)).toContain("  - [T2.2] It is ground to the sharpest edge");
  });

  it("reads standalone numbers only", () => {
    expect(numbersIn("About 1,500 blades at 0.1 mm, step0w1")).toEqual(["1500", "0.1"]);
  });
});

describe("hook support checks", () => {
  const hook = (line: string, claimIds: string[], featuredStageId = "T2") => ({ line, claimIds, featuredStageId });

  it("accepts a hook whose facts are in its cited claims", () => {
    expect(hookSupportFlags(hook("A steel strip about 0.1 mm thick becomes a razor blade.", ["T1.1"]), research)).toEqual([]);
    expect(hookSupportFlags(hook("Each blade is ground to the sharpest edge the line makes.", ["T2.2"]), research)).toEqual([]);
  });

  it("flags made-up claims, missing citations, unsupported numbers and superlatives", () => {
    expect(hookSupportFlags(hook("Blades are rolled.", ["T9.1"]), research)).toEqual(["Cites claims that don't exist: T9.1.", "Cites no research claim."]);
    expect(hookSupportFlags(hook("The strip is 0.05 mm thick.", ["T1.1"]), research)).toEqual(["Says 0.05, which the cited claims don't contain."]);
    expect(hookSupportFlags(hook("The world's fastest blade line.", ["T2.1"]), research)[0]).toMatch(/world.s.*isn't supported/);
    expect(hookSupportFlags(hook("Have you ever wondered how blades are made?", ["T1.1"]), research)).toContain("Opens with a stock phrase.");
    expect(hookSupportFlags(hook("Steel is rolled.", ["T1.1"], "T7"), research)).toContain("Featured stage T7 doesn't exist.");
  });

  it("totals reviewer scores out of 100 and never recommends a flagged or unsupported hook", () => {
    const all = (n: number) => ({ clarity: n, curiosity: n, specificity: n, connection: n, factualSupport: n, visualPotential: n, naturalLanguage: n });
    expect(hookTotal(all(5))).toBe(100);
    expect(hookTotal(all(1))).toBe(0);
    const hooks = [
      { flags: ["Says 9"], review: { supported: true }, total: 99 },
      { flags: [], review: { supported: false }, total: 95 },
      { flags: [], review: { supported: true }, total: 70 },
      { flags: [], review: { supported: true }, total: 80 },
    ];
    expect(recommendHook(hooks)).toBe(3);
    expect(recommendHook(hooks.slice(0, 2))).toBeNull();
  });
});

describe("the narration keeps the approved hook", () => {
  const hook = "A steel strip about 0.1 mm thick becomes a razor blade.";
  it("accepts the hook as written or tightened", () => {
    expect(hookOpeningIssues(`${hook} It starts as a coil of steel.`, hook)).toEqual([]);
    expect(hookOpeningIssues("A steel strip about 0.1 mm thick becomes a blade. It starts as a coil.", hook)).toEqual([]);
  });
  it("rejects a replaced opening, and a refinement that adds a number", () => {
    expect(hookOpeningIssues("Razors are everywhere. They start as steel.", hook)[0]).toMatch(/Open with the approved hook/);
    expect(hookOpeningIssues("A steel strip about 0.1 mm thick becomes 2 razor blades. It starts as a coil.", hook)[0]).toMatch(/adds 2/);
  });
});

describe("attention issues", () => {
  it("are never blocking, whatever the reviewer says", () => {
    const [i] = recordIssues(
      [{ category: "filler", severity: "blocking", kind: "contradiction", location: "s1", evidence: "steel is rolled", problem: "p", repair: "r" }],
      { stage: "attention", source: "The steel is rolled into a strip.", prefix: "A1." },
    );
    expect(i).toMatchObject({ severity: "significant", kind: "creative-concern", stage: "attention", id: "A1.1", verified: true });
  });
});
