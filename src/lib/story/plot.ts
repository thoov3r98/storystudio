import type { Plot } from "@/lib/schemas/story-plan";

/** Major story beats that fit a duration. Shots are separate: a shot change is not a beat. */
export function plotBeatRange(durationSec: number): [number, number] {
  if (durationSec <= 50) return [3, 5];
  if (durationSec <= 65) return [4, 6];
  if (durationSec <= 80) return [4, 7];
  return [5, 8];
}

/**
 * Deterministic structure checks on a plot, fed back to the model on failure.
 * They catch what can be caught mechanically: missing causes, references to
 * nothing, and payoffs that rely on something introduced only when needed.
 */
export function validatePlot(plot: Plot, opts: { durationSec: number }): string[] {
  const issues: string[] = [];
  const [minBeats, maxBeats] = plotBeatRange(opts.durationSec);
  const beats = plot.beats;
  if (beats.length < minBeats || beats.length > maxBeats) {
    issues.push(`Use ${minBeats}–${maxBeats} major beats for a ${opts.durationSec}s episode (you have ${beats.length}). Simplify rather than cram.`);
  }
  const ruleIds = new Set(plot.worldRules.map((r) => r.id));
  const setups = new Map(plot.setups.map((s) => [s.id, s]));

  const checkRefs = (refs: string[], beatNo: number, where: string) => {
    for (const ref of refs) {
      const id = ref.trim();
      if (/^B\d+$/.test(id)) {
        if (Number(id.slice(1)) >= beatNo) issues.push(`${where} depends on ${id}, which has not happened yet.`);
      } else if (/^S\d+$/.test(id)) {
        const s = setups.get(id);
        if (!s) issues.push(`${where} depends on ${id}, which is not in setups.`);
        else if (s.plantedInBeat >= beatNo) {
          issues.push(`${where} relies on ${id} ("${s.what}"), but the viewer only learns of it in beat ${s.plantedInBeat}. Plant it earlier or don't rely on it.`);
        }
      } else if (/^R\d+$/.test(id)) {
        if (!ruleIds.has(id)) issues.push(`${where} depends on ${id}, which is not in worldRules.`);
      } else {
        issues.push(`${where}: "${ref}" is not a beat, setup or rule id (use B1, S1, R1…).`);
      }
    }
  };

  beats.forEach((b, i) => {
    const where = `Beat ${i + 1}`;
    if (b.n !== i + 1) issues.push(`Beats must be numbered 1..N in order; position ${i + 1} is numbered ${b.n}.`);
    if (i === 0 && b.link !== "start") issues.push(`Beat 1's link must be "start".`);
    if (i > 0 && b.link === "start") issues.push(`${where}: only beat 1 can be "start"; use "but" or "therefore".`);
    if (i > 0 && b.enabledBy.length === 0) issues.push(`${where} has no cause: list the earlier beat, setup or rule that leads to it in enabledBy.`);
    checkRefs(b.enabledBy, i + 1, where);
  });
  if (beats.filter((b) => b.link === "meanwhile").length > 1) issues.push(`Use "meanwhile" at most once; each beat should follow from the last with "but" or "therefore".`);
  if (beats.length > 2 && !beats.some((b) => b.link === "but")) issues.push(`Nothing gets in the way: at least one beat should be a "but" (a complication).`);

  if (plot.resolution.enabledBy.length === 0) issues.push("The resolution must list what makes it possible (beats, setups or rules) in enabledBy.");
  checkRefs(plot.resolution.enabledBy, beats.length + 1, "The resolution");
  // A setup planted in the final beat and used to resolve the story is a convenience.
  for (const ref of plot.resolution.enabledBy) {
    const s = setups.get(ref.trim());
    if (s && beats.length > 1 && s.plantedInBeat >= beats.length) {
      issues.push(`The resolution relies on ${s.id} ("${s.what}"), introduced in the final beat. Plant it earlier so the ending is earned.`);
    }
  }
  for (const s of plot.setups) {
    if (s.plantedInBeat < 0 || s.plantedInBeat > beats.length) issues.push(`Setup ${s.id} is planted in beat ${s.plantedInBeat}, which does not exist (0 = opening state).`);
  }
  return issues;
}

/** The plot as compact text for prompts and evidence matching. */
export function plotText(plot: Plot): string {
  const lines = [
    `Archetype: ${plot.archetype}`,
    `Dramatic question: ${plot.dramaticQuestion}`,
    `Hero goal: ${plot.heroGoal}`,
    `Opening state: ${plot.openingState}`,
    `World rules: ${plot.worldRules.map((r) => `${r.id}: ${r.rule}`).join(" | ") || "none"}`,
    `Setups: ${plot.setups.map((s) => `${s.id} (beat ${s.plantedInBeat}): ${s.what}`).join(" | ") || "none"}`,
    ...plot.beats.map(
      (b) =>
        `B${b.n} [${b.link}] ${b.event}\n   cause: ${b.cause} (from ${b.enabledBy.join(", ") || "-"})\n   wants: ${b.heroWants} | knows: ${b.heroKnows}\n   after: ${b.state} | changes: ${b.changes}`,
    ),
    `Resolution (${plot.resolution.endingType}): ${plot.resolution.what} (from ${plot.resolution.enabledBy.join(", ")})`,
    `Deliberate mysteries: ${plot.deliberateMysteries.join(" | ") || "none"}`,
  ];
  return lines.join("\n");
}
