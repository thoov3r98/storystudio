# Channels

The studio is organised around TikTok channels (October 2026). Every channel is a How It's Made style explainer: a real product, researched on the web, told step by step across a few videos. Character stories (Kenny vs the World) were removed in November 2026 to focus on getting one format right.

## What a channel is

A `Channel` row has a **format**, a **profile** and production defaults:

- **Format.** `PROCESS_EXPLAINER` is the only format. The column stays so other formats can be added later.
- **Profile.** Summary, subjects, voice, shape, a never-list, Surprise me guidance and example ideas. `channelBlock()` puts it into every pitching, writing, checking and scene-rewrite prompt.
- **Production.** Voice, illustration style, length per video, parts range (`minParts`..`maxParts`) and quality.

A new channel is set up from a prompt: one model call (`channelDesignPrompt`) drafts the profile, and the producer edits it.

The launch channel, How It's Made, is seeded by migration `20261031120000_channels`.

## Making videos

```
Make Videos → channel → product (kept exactly) or Surprise me
  → 6 pitches written, Surprise me drops repeats of the channel's stories, reviewer keeps 3
  → producer picks one ("Write this story") → story with Part 1 → every part written → script gate
```

## Writing a series (`src/lib/process`)

```
web research (OpenAI web_search, cited) → research notes (stages T1..TN, steps, details, main route, sources, uncertain)
  → part plan (consecutive stages, 1+ per part, within the channel's range)
  → per part: narration from the notes only → fact/clarity/tone audit against the notes → targeted revisions (max 2)
  → storyboard
```

- The research is stored on `Story.research` and reused for part rewrites and replans, so a retry doesn't pay for the search again.
- Each version stores `spec.process` (the plan and its part) and `spec.quality` (every check, revision and its cost).
- Audit categories: `unsupported-claim`, `temporal`, `missing-connection`, `clarity`, `series-continuity`, `tone` and `too-technical`. A stated fact that contradicts the research is blocking.
- Unproduced episodes beyond the planned count are removed (`settlePartCount`).

## The script gate

- **Blocking**: a contradiction with the research, or a missing link a viewer would notice. The script is saved so it can be read, but it can't be approved until it is fixed, regenerated, or the issue is dismissed as a false positive (recorded).
- **Significant**: triggers a targeted revision. If it survives the retry limit, the script is "needs attention" and approving it is an explicit override.
- **Minor**: shown, never triggers a revision.
- Creative concerns can never block. Each issue must quote the script; if the quote is not found, the issue is shown as unverified and downgraded to minor.

Approving an episode only locks its script version; there is no story bible or continuation step.
