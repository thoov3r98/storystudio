import { z } from "zod";

/*
 * Story planning and verification. The structured plot is the source of truth
 * for an episode: narration is told from it, audits check against it, and
 * revisions repair it before the prose. See docs/story-quality.md.
 */

export const ARCHETYPES = ["survival", "mystery", "speculative", "comedy", "suspense", "everyday"] as const;
export type Archetype = (typeof ARCHETYPES)[number];

export const ENDING_TYPES = ["resolution", "failure", "escape", "discovery", "sacrifice", "irony", "cliffhanger"] as const;

export const HOOK_STYLES = [
  "plain-situation",
  "immediate-danger",
  "impossible-situation",
  "disturbing-discovery",
  "relatable-problem",
  "contradiction",
  "specific-mystery",
  "consequential-decision",
] as const;

// ── Causal plot ───────────────────────────────────────────────────────

export const PlotBeatSchema = z.object({
  n: z.number().int().describe("Beat number, 1..N in story order."),
  link: z
    .enum(["start", "but", "therefore", "meanwhile"])
    .describe('How this beat follows the previous one: "but" (a complication), "therefore" (a consequence or decision). "start" for beat 1 only; "meanwhile" rarely.'),
  event: z.string().describe("What happens, concretely, in one or two sentences."),
  cause: z.string().describe("Why it happens now: the earlier beat, planted setup or world rule that makes it possible."),
  enabledBy: z.array(z.string()).describe('Ids this beat depends on: earlier beats ("B2"), setups ("S1") or world rules ("R1"). Empty only for beat 1.'),
  heroWants: z.string().describe("What the hero is trying to do at this point."),
  heroKnows: z.string().describe("What the hero knows and does not know at this point."),
  state: z.string().describe("After this beat: where the hero is, their condition, what they are holding, roughly how much time has passed."),
  changes: z.string().describe("What is different after this beat."),
});

export const PlotSchema = z.object({
  archetype: z.enum(ARCHETYPES),
  dramaticQuestion: z.string().describe("The one question the viewer wants answered, e.g. 'Will Kenny find anyone else alive?'"),
  heroGoal: z.string(),
  openingState: z.string().describe("Where and when it starts, the hero's condition, and what they have with them."),
  worldRules: z
    .array(z.object({ id: z.string().describe('"R1", "R2"…'), rule: z.string() }))
    .describe("Rules of this world the story depends on, including impossible premises (e.g. 'everyone else vanished overnight; electricity still works'). Keep them fixed."),
  setups: z
    .array(z.object({ id: z.string().describe('"S1", "S2"…'), what: z.string(), plantedInBeat: z.number().int().describe("0 = true from the opening state.") }))
    .describe("Objects, skills, facts or people that later beats rely on, and where the viewer first learns of them."),
  beats: z.array(PlotBeatSchema),
  resolution: z.object({
    what: z.string().describe("How the episode ends."),
    enabledBy: z.array(z.string()).describe("The beats, setups and rules that make this ending possible."),
    endingType: z.enum(ENDING_TYPES),
  }),
  deliberateMysteries: z.array(z.string()).describe("Questions intentionally left unanswered for the viewer (e.g. why everyone vanished). Not plot holes."),
  parts: z
    .array(
      z.object({
        part: z.number().int().describe("1..P"),
        beats: z.array(z.number().int()).describe("The beat numbers this video tells, consecutive."),
        smallPayoff: z.string().describe("The question this video answers or the thing it resolves, so it satisfies on its own."),
        cliffhanger: z.string().describe("The real turn this video ends on, which the next part picks up. Empty for the final part."),
        newViewerLine: z.string().describe("For parts 2+: how the opening orients someone who starts here, in one spoken line. Empty for part 1."),
      }),
    )
    .describe("How the story splits into videos. One part for a single episode."),
});
export type Plot = z.infer<typeof PlotSchema>;
export type PlotPart = Plot["parts"][number];

export const PlotCandidatesSchema = z.object({ plots: z.array(PlotSchema) });

export const PlotPickSchema = z.object({
  reviews: z.array(z.object({ index: z.number().int(), strengths: z.string(), weaknesses: z.string() })),
  chosenIndex: z.number().int(),
  reason: z.string(),
});

// ── Logic audit ───────────────────────────────────────────────────────

export const LOGIC_CATEGORIES = [
  "causal-gap",
  "knowledge",
  "spatial",
  "temporal",
  "rule-violation",
  "motivation",
  "convenient-resolution",
  "character-behavior",
  "dropped-stakes",
  "missing-connection",
  "unpaid-setup",
  "series-continuity",
  "clarity",
  // Process explainers: checked against the research instead of a plot.
  "unsupported-claim",
  "tone",
] as const;

export const SEVERITIES = ["blocking", "significant", "minor"] as const;
export type Severity = (typeof SEVERITIES)[number];

export const AuditIssueSchema = z.object({
  category: z.enum(LOGIC_CATEGORIES),
  severity: z.enum(SEVERITIES),
  kind: z.enum(["contradiction", "creative-concern"]).describe('"contradiction": objectively inconsistent or unexplained. "creative-concern": works, but could be better.'),
  location: z.string().describe('Where: "Beat 3", "Resolution", or the line it is in.'),
  evidence: z.string().describe("An exact quote from the material you were given that shows the problem."),
  problem: z.string().describe("Why a viewer would be confused or stop believing it."),
  repair: z.string().describe("The smallest change that fixes it, at the earliest beat where the cause belongs."),
});
export type AuditIssue = z.infer<typeof AuditIssueSchema>;

export const LogicAuditSchema = z.object({
  intendedUnknowns: z
    .array(z.string())
    .describe("Things deliberately unexplained or impossible by design (the premise, kept mysteries, information withheld for a later reveal). These are not issues."),
  issues: z.array(AuditIssueSchema),
  previousIssues: z
    .array(z.object({ id: z.string(), resolved: z.boolean(), note: z.string() }))
    .describe("Only when earlier issues are listed: whether each one is now fixed."),
});
export type LogicAudit = z.infer<typeof LogicAuditSchema>;

// ── Editorial review ──────────────────────────────────────────────────

export const RATINGS = ["weak", "acceptable", "strong", "excellent"] as const;
export type Rating = (typeof RATINGS)[number];

export const NARRATIVE_CRITERIA = ["premise", "dramatic-question", "every-beat-matters", "earned-escalation", "believable-reactions", "economy", "freshness", "ending", "worth-the-time"] as const;
export const RETENTION_CRITERIA = ["first-line", "instant-clarity", "curiosity-gap", "starts-late", "hook-delivered", "steady-change", "payoff"] as const;

const criterionReview = <T extends readonly [string, ...string[]]>(criteria: T) =>
  z.object({
    criterion: z.enum(criteria),
    rating: z.enum(RATINGS),
    evidence: z.string().describe("An exact quote from the script that the rating is based on."),
    note: z.string().describe("One specific sentence."),
  });

export const EditorialNoteSchema = z.object({
  area: z.enum(["narrative", "hook", "retention"]),
  evidence: z.string().describe("An exact quote from the script."),
  problem: z.string(),
  fix: z.string().describe("A concrete change."),
});
export type EditorialNote = z.infer<typeof EditorialNoteSchema>;

export const EditorialReviewSchema = z.object({
  narrative: z.array(criterionReview(NARRATIVE_CRITERIA)),
  retention: z.array(criterionReview(RETENTION_CRITERIA)),
  mustFix: z.array(EditorialNoteSchema).describe("Problems that clearly make the video worse for a viewer. Empty if none."),
  suggestions: z.array(EditorialNoteSchema).describe("Optional improvements; never required."),
});
export type EditorialReview = z.infer<typeof EditorialReviewSchema>;

// ── Hooks ─────────────────────────────────────────────────────────────

export const HookCandidatesSchema = z.object({
  dramaticQuestion: z.string(),
  strongestMoment: z.string().describe("The most interesting concrete moment in the plot to open on or point at."),
  candidates: z.array(
    z.object({
      style: z.enum(HOOK_STYLES),
      text: z.string().describe("The opening line or two, exactly as narrated."),
      promise: z.string().describe("What this opening promises the viewer."),
      paidOffIn: z.string().describe("Which beat delivers on that promise, and how."),
    }),
  ),
});
export type HookCandidates = z.infer<typeof HookCandidatesSchema>;

/** Hook candidates for every part of a story at once. */
export const PartHookCandidatesSchema = z.object({ parts: z.array(HookCandidatesSchema.extend({ part: z.number().int() })) });

export const HookPickSchema = z.object({
  reviews: z.array(
    z.object({
      index: z.number().int(),
      clarity: z.enum(RATINGS),
      curiosity: z.enum(RATINGS),
      specificity: z.enum(RATINGS),
      deliveredByPlot: z.boolean().describe("Does the planned plot fully pay off what this opening promises?"),
      note: z.string(),
    }),
  ),
  chosenIndex: z.number().int(),
  hook: z.string().describe("The chosen opening, refined. One or two sentences, ready to be read aloud."),
  promise: z.string(),
});
export type HookPick = z.infer<typeof HookPickSchema>;

export const PartHookPickSchema = z.object({ parts: z.array(HookPickSchema.extend({ part: z.number().int() })) });

// ── Narration and revision ────────────────────────────────────────────

const narrationFields = {
  title: z.string(),
  storyNarration: z.string().describe("The complete voiceover as one continuous story, read aloud."),
  summary: z.string().describe("3–5 sentence summary of what happens and what is revealed."),
  keyReveals: z.array(z.string()),
  unresolvedQuestions: z.array(z.string()),
  beatCoverage: z.array(z.object({ beat: z.number().int(), opensWith: z.string().describe("The first few words of the narration where this beat is told.") })),
};

export const StoryNarrationSchema = z.object({
  ...narrationFields,
  planChanges: z.array(z.string()).describe("Any way the narration departs from the approved plot. Should normally be empty."),
});
export type StoryNarration = z.infer<typeof StoryNarrationSchema>;

export const ScriptRevisionSchema = z.object({
  diagnosis: z.array(z.object({ issueId: z.string(), rootBeat: z.number().int().describe("The earliest beat where the cause belongs."), rootCause: z.string() })),
  plot: PlotSchema.describe("The full plot with repairs applied; unchanged beats copied as they were."),
  ...narrationFields,
  changeLog: z.array(z.object({ issueId: z.string(), change: z.string() })),
});
export type ScriptRevision = z.infer<typeof ScriptRevisionSchema>;

export const PlotRepairSchema = z.object({
  diagnosis: z.array(z.object({ issueId: z.string(), rootBeat: z.number().int(), rootCause: z.string() })),
  plot: PlotSchema,
  changeLog: z.array(z.object({ issueId: z.string(), change: z.string() })),
});

// ── Quality record stored on each version ─────────────────────────────

export const QUALITY_STATUSES = ["passed", "needs-attention", "blocked"] as const;
export type QualityStatus = (typeof QUALITY_STATUSES)[number];

/** An issue as stored: audit output plus an id, where it was found and whether its quote was verified. */
export const RecordedIssueSchema = AuditIssueSchema.extend({
  id: z.string(),
  stage: z.enum(["plot", "script", "continuity"]),
  verified: z.boolean(),
});
export type RecordedIssue = z.infer<typeof RecordedIssueSchema>;

export const QualityRecordSchema = z.object({
  pipelineVersion: z.literal(2),
  /** Which part of a multi-part story this script is (1 for single episodes). */
  part: z.number().int().default(1),
  status: z.enum(QUALITY_STATUSES),
  plotRounds: z.array(z.object({ issues: z.array(RecordedIssueSchema), changeLog: z.array(z.object({ issueId: z.string(), change: z.string() })).default([]) })),
  scriptRounds: z.array(
    z.object({
      issues: z.array(RecordedIssueSchema),
      mustFix: z.array(EditorialNoteSchema),
      changeLog: z.array(z.object({ issueId: z.string(), change: z.string() })).default([]),
      unresolvedPrevious: z.array(z.string()).default([]),
    }),
  ),
  /** Open items on the final script. */
  issues: z.array(RecordedIssueSchema),
  mustFix: z.array(EditorialNoteSchema),
  editorial: EditorialReviewSchema.nullable(),
  hooks: z.object({ candidates: HookCandidatesSchema, pick: HookPickSchema }).nullable(),
  plotPick: z.object({ reason: z.string(), rejected: z.string() }).nullable(),
  references: z.array(z.string()).default([]),
  dismissed: z.array(z.object({ issueId: z.string(), at: z.string(), note: z.string().default("") })).default([]),
  override: z.object({ at: z.string(), open: z.number().int() }).nullable().default(null),
  metrics: z.object({
    firstPass: z.boolean(),
    plotRepairs: z.number().int(),
    scriptRevisions: z.number().int(),
    blockingFound: z.number().int(),
    significantFound: z.number().int(),
    unverifiedIssues: z.number().int(),
    durationMs: z.number(),
    textCostUsd: z.number(),
  }),
});
export type QualityRecord = z.infer<typeof QualityRecordSchema>;

// ── Legacy (versions written before October 2026) ─────────────────────

const Score = z.number().int();
export const LegacyStoryOutlineSchema = z.object({ logline: z.string(), beats: z.array(z.string()) });
export const LegacyStoryReviewSchema = z.object({ scores: z.record(z.string(), Score), notes: z.array(z.string()) });
