# Story quality: how scripts are planned, checked and repaired

This note records why the script pipeline was rebuilt (October 2026) and how the new one works.

## What was wrong (audit of the previous pipeline)

| Finding | Where | Effect |
|---|---|---|
| One formula for every story: hero's flaw causes trouble, three escalations, clever move, joke, ending that makes things worse | `STORY_CRAFT` in `prompts.ts`; `StoryOutlineSchema` required `trigger`, `escalations`, `cleverMove`, `funnyMoment`, `endingTurn`; validation demanded 3 escalations and 6–9 beats | Arbitrary complications and forced jokes; mysteries and quiet apocalypse stories bent into the same shape |
| The outline was a list of one-sentence beats with no cause, knowledge, location or possessions | `StoryOutlineSchema.beats: string[]` | Nothing could check logic before prose; the writer invented causes (and rescue objects) while writing |
| One writer call produced prose, visual state, 10–15 shots and the bible update together | `writerPrompt` / `EpisodeDraftSchema` | Very large output; the story was the least-checked part of it |
| The "editor" was the writer model scoring its own output 1–10 with a pass mark of 7, on the prose alone | `storyReviewPrompt` used `writerModel` | Lenient; never looked for plot holes; no evidence required |
| Revision rewrote the whole draft JSON and was never re-reviewed | `revisionPrompt` | Fixes broke other parts; a failing script was accepted after one try |
| Part 1 had no consistency check at all; Part 2+ only checked against earlier episodes, with the fast model | `continuityPrompt`, Standard preset `reviewerModel: "fast"` | Internal contradictions in an episode were never caught |
| The hook was whatever the first sentence of the narration happened to be | `selectedHook` copied from the narration | No alternatives, no check that the story pays off the opening |
| Concepts were scored for appeal only | `CRITERIA` | A thrilling premise that can't become a coherent 75 s story beat a workable one |
| ~170 words, 10–15 shots and 6–9 beats with 3 escalations | `SCENE_COUNT_RANGE`, outline rules | Too many events for the time, so explanations were cut first |
| No examples of good stories | — | The model learned only from adjectives |

## The new pipeline

```
Idea (+ archetype, dramatic question, 3-line beat sketch)
  → Evaluation (adds "can this become a coherent, satisfying episode?"; weak ones rank last)
Episode:
  1. Plot candidates   (writer)    two causal plots: beats with cause, what the hero wants/knows, state, BUT/THEREFORE links, planted setups, world rules
                                   + deterministic checks: beat count for the length, references exist, payoffs planted earlier
  2. Plot pick         (reviewer)  narrative editor chooses the stronger plot
  3. Plot logic audit  (reviewer)  evidence-cited issues; repair → re-audit (max 2). Blocking issues left → stop, no narration written
  4. Hooks             (writer)    dramatic question, strongest moment, 4–6 hooks in different styles
  5. Hook pick         (reviewer)  each hook judged against the plot; one chosen and refined
  6. Narration         (writer)    told from the approved plot, opening with the chosen hook, with 1–2 matching reference stories as craft examples
  7. Script checks     (reviewer)  logic audit of the narration against the plot (+ series context), editorial review (narrative + hook/retention), continuity for Part 2+
  8. Targeted revision (writer)    diagnose root beat → repair plot + rewrite affected narration, with a change log → step 7 again (max 2)
  9. Scene breakdown   (writer)    visual state, shots (exact word-for-word cut), bible update
 10. Gate                          passed / needs attention (approve with explicit override) / blocked (cannot be approved)
```

The reviewer model is configurable (Settings → Models: "Story reviewer", defaults to the main model). Draft quality uses the fast model for everything.

### Stories in several parts

New stories are planned across several videos (Settings → Parts per story, default 4). Writing Part 1 plans ONE causal plot for the whole story and splits its beats into parts of 2–4 beats each, so each ~75 s video has room for reactions and atmosphere instead of cramming a whole story into 190 words. Each part pays off one small question of its own, every part but the last ends on a cliffhanger that is a real turn in the plot, and Parts 2+ open with a line that orients a viewer who starts there.

The plan is audited once; hooks for every part are developed in one pass; then each part is narrated, checked and revised in order (each sees what the earlier parts actually said), and the shots are cut. All parts land at the script gate; media is made one part at a time when you approve each. "Rewrite Part N" rewrites one part from the saved plan; "Replan all parts" (Part 1, before anything is produced) starts the story over. Planning cost is shared equally across the parts in each script's recorded cost.

### Validation policy

- **Blocking**: a real contradiction or missing causal link a viewer would notice. Plot stage: narration is not written. Script stage: the script is saved so you can read it, but it cannot be approved until it is fixed, regenerated, or you dismiss the issue as a false positive (recorded).
- **Significant**: triggers a targeted revision. If it survives the retry limit, the script is "needs attention" and approving it is an explicit override.
- **Minor**: shown, never triggers a revision.
- Creative concerns can never be blocking. Each issue must quote the story; if the quote is not found, the issue is shown as unverified and downgraded to minor.

### Measurement

Each version's `spec.quality` records issues per audit round, revisions and their change logs, editorial ratings, hook candidates, time and text cost. The Quality page summarises them along with your approvals, rejections, ratings and any TikTok numbers you enter per episode. AI ratings are editorial heuristics, not audience predictions.

`pnpm story-eval audit` runs the real auditor on the fixed benchmark in `tests/story-bench` (seeded flaws and clean stories) and reports detection and false-positive rates. `pnpm story-eval generate` writes scripts for fixed premises with the real pipeline, for side-by-side human review. Results go to `evals/results/`.
