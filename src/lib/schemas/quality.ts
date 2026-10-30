import { z } from "zod";

/*
 * Script checks. Every part is audited against its research notes; issues must
 * quote the script, and the gate status decides whether media can be made.
 */

export const LOGIC_CATEGORIES = ["unsupported-claim", "temporal", "missing-connection", "clarity", "series-continuity", "tone", "too-technical"] as const;

export const SEVERITIES = ["blocking", "significant", "minor"] as const;
export type Severity = (typeof SEVERITIES)[number];

/** Attention and payoff: editorial pacing problems. Never blocking: they can't hold back a factually sound script. */
export const ATTENTION_CATEGORIES = ["weak-opening", "slow-start", "unanswered-question", "filler", "missing-payoff", "weak-ending", "name-dropping"] as const;
export const ISSUE_CATEGORIES = [...LOGIC_CATEGORIES, ...ATTENTION_CATEGORIES] as const;

const issueFields = {
  severity: z.enum(SEVERITIES),
  kind: z.enum(["contradiction", "creative-concern"]).describe('"contradiction": objectively inconsistent or unexplained. "creative-concern": works, but could be better.'),
  location: z.string().describe("Where: the line it is in."),
  evidence: z.string().describe("An exact quote from the material you were given that shows the problem."),
  problem: z.string().describe("Why a viewer would be confused or stop believing it."),
  repair: z.string().describe("The smallest change that fixes it."),
};

export const AuditIssueSchema = z.object({ category: z.enum(LOGIC_CATEGORIES), ...issueFields });
export const AttentionIssueSchema = z.object({ category: z.enum(ATTENTION_CATEGORIES), ...issueFields });
export type AuditIssue = z.infer<typeof AuditIssueSchema> | z.infer<typeof AttentionIssueSchema>;

export const LogicAuditSchema = z.object({
  intendedUnknowns: z.array(z.string()).describe("Things deliberately left out or simplified by design. These are not issues."),
  issues: z.array(AuditIssueSchema),
  previousIssues: z
    .array(z.object({ id: z.string(), resolved: z.boolean(), note: z.string() }))
    .describe("Only when earlier issues are listed: whether each one is now fixed."),
});
export type LogicAudit = z.infer<typeof LogicAuditSchema>;

export const AttentionAuditSchema = z.object({ issues: z.array(AttentionIssueSchema) });

// ── Quality record stored on each version ─────────────────────────────

export const QUALITY_STATUSES = ["passed", "needs-attention", "blocked"] as const;
export type QualityStatus = (typeof QUALITY_STATUSES)[number];

/** An issue as stored: audit output plus an id, where it was found and whether its quote was verified. */
export const RecordedIssueSchema = z.object({
  category: z.enum(ISSUE_CATEGORIES),
  ...issueFields,
  id: z.string(),
  stage: z.enum(["script", "continuity", "attention"]),
  verified: z.boolean(),
});
export type RecordedIssue = z.infer<typeof RecordedIssueSchema>;

const ChangeLogSchema = z.array(z.object({ issueId: z.string(), change: z.string() }));

export const QualityRecordSchema = z.object({
  pipelineVersion: z.literal(2),
  /** Which part of the series this script is. */
  part: z.number().int().default(1),
  status: z.enum(QUALITY_STATUSES),
  scriptRounds: z.array(
    z.object({
      issues: z.array(RecordedIssueSchema),
      changeLog: ChangeLogSchema.default([]),
      unresolvedPrevious: z.array(z.string()).default([]),
    }),
  ),
  /** Open items on the final script. */
  issues: z.array(RecordedIssueSchema),
  dismissed: z.array(z.object({ issueId: z.string(), at: z.string(), note: z.string().default("") })).default([]),
  override: z.object({ at: z.string(), open: z.number().int() }).nullable().default(null),
  metrics: z.object({
    firstPass: z.boolean(),
    scriptRevisions: z.number().int(),
    blockingFound: z.number().int(),
    significantFound: z.number().int(),
    unverifiedIssues: z.number().int(),
    durationMs: z.number(),
    textCostUsd: z.number(),
  }),
});
export type QualityRecord = z.infer<typeof QualityRecordSchema>;
