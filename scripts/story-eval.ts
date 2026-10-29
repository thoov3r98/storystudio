/*
 * Optional evaluation with REAL models (costs money; never run in CI).
 *
 *   pnpm story-eval audit [--model gpt-5.5]           logic auditor vs. the fixed benchmark
 *   pnpm story-eval generate [--only id,id] [--parts 4] [--writer m] [--reviewer m]
 *                                                     full script pipeline on fixed premises
 *
 * Needs OPENAI_API_KEY (read from .env). No database is used. Results are
 * written to evals/results/ as JSON (and Markdown for generated scripts) so
 * runs can be compared over time and read side by side by a human.
 */
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { openAIStructuredClient } from "@/lib/ai/openai";
import { generateStructured } from "@/lib/ai/structured";
import { scriptAuditPrompt } from "@/lib/ai/story-prompts";
import { DEFAULT_PRICING } from "@/lib/costs/pricing";
import { LogicAuditSchema } from "@/lib/schemas/story-plan";
import { emptyBible } from "@/lib/schemas/story-bible";
import { composeStory } from "@/lib/story/compose";
import { BUILT_IN_REFERENCES } from "@/lib/story/references";
import { recordIssues } from "@/lib/story/review";
import { BENCH_CASES } from "../tests/story-bench/cases";
import { BENCH_PREMISES } from "../tests/story-bench/premises";

const OUT = path.join(process.cwd(), "evals/results");
const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const mainModel = process.env.OPENAI_TEXT_MODEL ?? "gpt-5.5";

function save(name: string, data: unknown, markdown?: string) {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(path.join(OUT, `${name}.json`), JSON.stringify(data, null, 2));
  if (markdown) writeFileSync(path.join(OUT, `${name}.md`), markdown);
  console.log(`\nSaved evals/results/${name}.json${markdown ? " and .md" : ""}`);
}

function previous(prefix: string): { summary?: Record<string, number> } | null {
  try {
    const files = readdirSync(OUT)
      .filter((f) => f.startsWith(prefix) && f.endsWith(".json"))
      .sort();
    return files.length ? JSON.parse(readFileSync(path.join(OUT, files.at(-1)!), "utf8")) : null;
  } catch {
    return null;
  }
}

async function audit() {
  const model = flag("model") ?? mainModel;
  const prior = previous("audit-");
  let cost = 0;
  const results = [];
  for (const c of BENCH_CASES) {
    const series = c.series
      ? { bible: { ...emptyBible({ premise: c.premise, styleKey: "stick-figure" }), narrativePerspective: "Close third person, past tense", constraints: c.series.facts }, previousSummaries: c.series.previousSummaries }
      : null;
    const prompt = scriptAuditPrompt({ plot: null, narration: c.narration, premise: c.premise, series });
    const started = Date.now();
    const out = await generateStructured({ client: openAIStructuredClient, pricing: DEFAULT_PRICING, model, ...prompt, schema: LogicAuditSchema, schemaName: "script_audit", onCost: (u) => (cost += u) });
    const issues = recordIssues(out.issues, { stage: "script", source: prompt.user, prefix: "B" });
    const serious = issues.filter((i) => i.severity !== "minor");
    const caught = c.kind === "flawed" ? serious.some((i) => c.expect.includes(i.category)) : null;
    const falseBlock = c.kind === "sound" ? issues.some((i) => i.severity === "blocking") : null;
    const falseSignificant = c.kind === "sound" ? serious.length > 0 : null;
    results.push({ id: c.id, kind: c.kind, caught, falseBlock, falseSignificant, ms: Date.now() - started, issues, intendedUnknowns: out.intendedUnknowns });
    const mark = c.kind === "flawed" ? (caught ? "caught" : "MISSED") : falseBlock ? "FALSE BLOCK" : falseSignificant ? "flagged (significant)" : "clean";
    console.log(`${c.kind.padEnd(6)} ${c.id.padEnd(34)} ${mark}${serious.length ? `  [${serious.map((i) => `${i.severity}:${i.category}`).join(", ")}]` : ""}`);
  }
  const flawed = results.filter((r) => r.kind === "flawed");
  const sound = results.filter((r) => r.kind === "sound");
  const summary = {
    detectionPct: (100 * flawed.filter((r) => r.caught).length) / flawed.length,
    falseBlockPct: (100 * sound.filter((r) => r.falseBlock).length) / sound.length,
    falseSignificantPct: (100 * sound.filter((r) => r.falseSignificant).length) / sound.length,
    unverifiedIssues: results.reduce((n, r) => n + r.issues.filter((i) => !i.verified).length, 0),
    costUsd: Math.round(cost * 1000) / 1000,
  };
  console.log(`\nDetection of seeded holes: ${summary.detectionPct.toFixed(0)}%   False blocks on sound stories: ${summary.falseBlockPct.toFixed(0)}%   Sound stories with any significant flag: ${summary.falseSignificantPct.toFixed(0)}%   Cost $${summary.costUsd}`);
  if (prior?.summary) console.log(`Previous run: detection ${prior.summary.detectionPct?.toFixed(0)}%, false blocks ${prior.summary.falseBlockPct?.toFixed(0)}%`);
  save(`audit-${stamp}`, { model, summary, results });
}

async function generate() {
  const only = flag("only")?.split(",");
  const writer = flag("writer") ?? mainModel;
  const reviewer = flag("reviewer") ?? writer;
  const parts = Number(flag("parts") ?? 1);
  const premises = BENCH_PREMISES.filter((p) => !only || only.includes(p.id));
  const out: unknown[] = [];
  let md = `# Generated scripts — ${stamp}\n\nWriter ${writer}, reviewer ${reviewer}. Read each for plot holes and whether you'd watch to the end.\n`;
  for (const p of premises) {
    const started = Date.now();
    process.stdout.write(`${p.id}… `);
    try {
      const results = await composeStory(
        {
          storyId: `bench-${p.id}`,
          title: p.title,
          premise: p.premise,
          partNumber: 1,
          durationSec: 75,
          wordsPerSecond: 2.5,
          narrator: p.narrator ?? null,
          bible: emptyBible({ premise: p.premise, styleKey: "stick-figure" }),
          previousEpisodes: [],
          latestEpisode: null,
          seed: p.seed ?? null,
          parts,
        },
        { text: openAIStructuredClient, pricing: DEFAULT_PRICING, writer, reviewer, references: BUILT_IN_REFERENCES },
      );
      const cost = results.reduce((t, r) => t + r.quality.metrics.textCostUsd, 0);
      console.log(`${results.map((r) => r.quality.status).join("/")} · $${cost.toFixed(2)} · ${Math.round((Date.now() - started) / 1000)}s`);
      md += `\n## ${p.title} (${results[0].plot.archetype}, ${results.length} part${results.length > 1 ? "s" : ""})\n\n$${cost.toFixed(2)} · ${Math.round((Date.now() - started) / 1000)}s\n`;
      for (const result of results) {
        const q = result.quality;
        out.push({ id: p.id, part: q.part, status: q.status, metrics: q.metrics, narration: result.draft.storyNarration, hook: result.draft.selectedHook, plot: result.plot, quality: q });
        md += `\n### ${results.length > 1 ? `Part ${q.part}: ` : ""}${result.draft.title}\n\nStatus: **${q.status}** · ${q.metrics.plotRepairs} plot repairs · ${q.metrics.scriptRevisions} script revisions\n\n> ${result.draft.storyNarration}\n\n${
        q.issues.length || q.mustFix.length
          ? `Open notes:\n${[...q.issues.map((i) => `- ${i.severity} ${i.category}: ${i.problem}`), ...q.mustFix.map((n) => `- editor: ${n.problem}`)].join("\n")}\n`
          : "No open notes.\n"
      }`;
      }
      md += `\nHuman review: logic holes? ______  would you watch every part (1–5)? ______\n`;
    } catch (err) {
      console.log(`failed: ${err instanceof Error ? err.message : String(err)}`);
      out.push({ id: p.id, status: "failed", error: err instanceof Error ? err.message : String(err) });
      md += `\n## ${p.title}\n\nFailed: ${err instanceof Error ? err.message : String(err)}\n`;
    }
  }
  save(`generate-${stamp}`, { writer, reviewer, parts, results: out }, md);
}

const mode = args[0];
const run = mode === "audit" ? audit : mode === "generate" ? generate : null;
if (!run) {
  console.log("Usage: pnpm story-eval audit [--model m] | generate [--only id,id] [--writer m] [--reviewer m]");
  process.exit(1);
}
run().catch((err) => {
  console.error(err);
  process.exit(1);
});
