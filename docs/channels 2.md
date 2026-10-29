# Channels

The studio is organised around TikTok channels (October 2026). They replace the old topic categories, which were too vague to steer the writing.

## What a channel is

A `Channel` row has a **format**, a **profile** and production defaults:

- **Format.** `CHARACTER_STORY` stories star the channel's character and use the planned story pipeline (`src/lib/story`, see `story-quality.md`). `PROCESS_EXPLAINER` videos explain how a real product is made, researched on the web first (`src/lib/process`).
- **Profile.** Summary, subjects, voice, shape, a never-list, Surprise me guidance and example ideas. `channelBlock()` puts it into every pitching, writing, hook, editorial and audit prompt. It outranks the general craft notes.
- **Production.** Character, narrator perspective (overrides the character's own), voice, illustration style, length per video, parts range (`minParts`..`maxParts`) and quality.

A new channel is set up from a prompt: one model call (`channelDesignPrompt`) drafts the profile, and the producer edits it.

The launch channels, Kenny vs the World and How It's Made, are seeded by migration `20261031120000_channels`, which also archives every story made before channels.

## Making videos

```
Make Videos → channel → idea (kept exactly) or Surprise me
  → 6 pitches written, Surprise me drops repeats of the channel's stories, reviewer keeps 3
  → producer picks one ("Write this story") → story with Part 1 → every part written → script gate
```

The planner chooses how many parts within the channel's range. Unproduced episodes beyond that count are removed (`settlePartCount`).

## Process explainers

```
web research (OpenAI web_search, cited) → research notes (stages T1..TN, steps, details, sources, uncertain)
  → part plan (consecutive stages, 1+ per part)
  → per part: narration from the notes only → fact/clarity/tone audit against the notes → targeted revisions (max 2)
  → storyboard
```

- The research is stored on `Story.research` and reused for part rewrites and replans, so a retry doesn't pay for the search again.
- Each version stores `spec.process` (the plan and its part) instead of a plot.
- Audit categories: `unsupported-claim`, `temporal`, `missing-connection`, `clarity`, `series-continuity` and `tone`. A stated fact that contradicts the research is blocking.
- The episode page shows the plan, the research for the part, and the numbered sources.
