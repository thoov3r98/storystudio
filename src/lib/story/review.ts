import type { AuditIssue, EditorialNote, QualityRecord, QualityStatus, RecordedIssue } from "@/lib/schemas/story-plan";
import { tokenize } from "@/lib/text";

/** Generic hooks that promise nothing specific. A chosen hook containing one is rejected. */
export const GENERIC_HOOK_PHRASES = [
  "you won't believe",
  "you will not believe",
  "everything was about to change",
  "everything changed",
  "little did",
  "what happened next",
  "nothing could have prepared",
  "it all started",
  "this is the story of",
  "knew something was wrong",
  "knew something was terribly wrong",
  "had no idea",
  "but that was just the beginning",
];

export function genericHookPhrase(hook: string): string | null {
  const h = hook.toLowerCase().replace(/[’']/g, "'");
  return GENERIC_HOOK_PHRASES.find((p) => h.includes(p)) ?? null;
}

/**
 * Whether a reviewer's quote really appears in the material. Lenient about
 * punctuation and case, and accepts a partial quote when at least one run of
 * four consecutive words matches, so paraphrased-but-real evidence still counts.
 */
export function evidenceFound(quote: string, source: string): boolean {
  const q = tokenize(quote);
  if (q.length === 0) return false;
  const src = ` ${tokenize(source).join(" ")} `;
  if (src.includes(` ${q.join(" ")} `)) return true;
  if (q.length < 4) return false;
  for (let i = 0; i + 4 <= q.length; i++) {
    if (src.includes(` ${q.slice(i, i + 4).join(" ")} `)) return true;
  }
  return false;
}

/**
 * Normalises raw audit output into recorded issues: creative concerns can
 * never block, and issues whose evidence cannot be found are kept for the
 * producer to see but downgraded to minor.
 */
export function recordIssues(issues: AuditIssue[], opts: { stage: RecordedIssue["stage"]; source: string; prefix: string }): RecordedIssue[] {
  return issues.map((issue, i) => {
    const verified = evidenceFound(issue.evidence, opts.source);
    let severity = issue.severity;
    if (issue.kind === "creative-concern" && severity === "blocking") severity = "significant";
    if (!verified) severity = "minor";
    return { ...issue, severity, verified, stage: opts.stage, id: `${opts.prefix}${i + 1}` };
  });
}

export function verifiedNotes(notes: EditorialNote[], source: string): EditorialNote[] {
  return notes.filter((n) => evidenceFound(n.evidence, source));
}

const active = (issues: RecordedIssue[], dismissed: Set<string>) => issues.filter((i) => !dismissed.has(i.id));

/** Whether a round of checks calls for a revision. Minor issues, ratings and suggestions never do. */
export function needsRevision(issues: RecordedIssue[], mustFix: EditorialNote[]): boolean {
  return issues.some((i) => i.severity === "blocking" || i.severity === "significant") || mustFix.length > 0;
}

/** The gate decision for a finished script. Blocking issues can only be cleared by fixing them or dismissing them as false positives. */
export function qualityStatus(input: { issues: RecordedIssue[]; mustFix: EditorialNote[]; dismissed?: string[] }): QualityStatus {
  const open = active(input.issues, new Set(input.dismissed ?? []));
  if (open.some((i) => i.severity === "blocking")) return "blocked";
  if (open.some((i) => i.severity === "significant") || input.mustFix.length > 0) return "needs-attention";
  return "passed";
}

/** Recomputes the status after the producer dismisses an issue as a false positive. */
export function withDismissal(quality: QualityRecord, issueId: string, note: string): QualityRecord {
  if (!quality.issues.some((i) => i.id === issueId) || quality.dismissed.some((d) => d.issueId === issueId)) return quality;
  const dismissed = [...quality.dismissed, { issueId, at: new Date().toISOString(), note }];
  return { ...quality, dismissed, status: qualityStatus({ issues: quality.issues, mustFix: quality.mustFix, dismissed: dismissed.map((d) => d.issueId) }) };
}

/** Open (not dismissed) blocking and significant issues plus must-fix notes. */
export function openItems(quality: QualityRecord): { blocking: RecordedIssue[]; significant: RecordedIssue[]; mustFix: EditorialNote[] } {
  const open = active(quality.issues, new Set(quality.dismissed.map((d) => d.issueId)));
  return { blocking: open.filter((i) => i.severity === "blocking"), significant: open.filter((i) => i.severity === "significant"), mustFix: quality.mustFix };
}

/** Issues as a numbered list for a revision prompt, with ids the model reports back on. */
export function issueBrief(issues: RecordedIssue[], mustFix: EditorialNote[]): { id: string; text: string }[] {
  return [
    ...issues
      .filter((i) => i.severity !== "minor")
      .map((i) => ({ id: i.id, text: `[${i.severity}, ${i.category}] at ${i.location}: "${i.evidence}" — ${i.problem} Suggested repair: ${i.repair}` })),
    ...mustFix.map((n, k) => ({ id: `E${k + 1}`, text: `[editor, ${n.area}] "${n.evidence}" — ${n.problem} Fix: ${n.fix}` })),
  ];
}
