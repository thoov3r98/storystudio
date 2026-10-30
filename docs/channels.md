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
  Surprise me, reference library not empty → topic discovery (below) → 3 scored, diverse topics
  Surprise me, empty library or discovery fails → 6 pitches written, repeats dropped, reviewer keeps 3
  Producer's product → 6 pitches of that product; library videos about it attached as evidence only
  → producer picks one ("Write this story") → story with Part 1 → every part written → script gate
```

## Topic discovery (`src/lib/topics`, Topic Research page)

- **Reference library** (`ManufacturingContentReference`): successful manufacturing videos by others, entered by hand or from a URL. Title and creator can be read from the platforms' official oEmbed endpoints; with `YOUTUBE_API_KEY`, YouTube view/like/comment counts too. Nothing is scraped. A starter set (checked 2026-10-29) only has a URL where one could be confirmed, and no numbers.
- **Metrics are observations** (`ReferenceMetricObservation`): dated, with a source. `MANUAL` is unverified; only `YOUTUBE_API` is verified. A number nobody saw is null, never zero.
- **Traction** (`scoring.ts`, code only): YouTube/other judged by views per month since publishing (publish date unknown → treated as 3 years old), TikTok/Instagram by total with their own bars. Hand-entered numbers count at 80%.
- **Discovery** (`discover.ts`), two model calls per run: ideas linked to library ids (evidence-backed / adjacent / exploratory) → drop repeats of the channel's stories, approved or used topics, and library products → one reviewer call rates visual, familiarity, surprise, research availability and visual feasibility (0–10). Ratings for a product rated in the last 30 days are reused.
- **Score** (0–100): comparable evidence 25%, visual 25%, familiarity 15%, surprise 15%, research 10%, visual feasibility 10%. Evidence is computed from the library, never by a model; no evidence scores 0 and a strategy can't claim evidence it doesn't have. Weights are starting heuristics.
- **Picks**: top 3 by score, no two from the same category or near-identical products while others remain.
- The chosen topic's snapshot (`DiscoverySnapshot`) is copied to `Concept.discovery` and `Story.discovery`; the curiosity angle reaches the storytelling prompt as a hint the research must back. The product is never changed downstream.

## Writing a series (`src/lib/process`)

```
web research (OpenAI web_search, cited) → research notes (stages T1..TN, steps, details, main route, sources, uncertain)
  → part plan (consecutive stages, 1+ per part, within the channel's range)
    ∥ storytelling decision (pattern, featured stage, per-stage visual metadata)
  → 5 hooks citing research claims → deterministic support checks → independent hook review → recommended hook
  → per part: narration from the notes only (Part 1 opens with the hook) →
    fact/clarity/tone audit + attention/payoff audit → targeted revisions (max 2)
  → storyboard
```

### Storytelling and hooks (`creative.ts`, `schemas/storytelling.ts`)

- Research steps are numbered claims: `T2.1` is stage T2, step 1. Prompts show them as `[T2.1]`.
- **Patterns**: Transformation, Hidden engineering problem, Factory reveal. Chosen from the researched facts (`ManufacturingStorytellingDecision`, one per story). They shape emphasis only: the opening may preview a later step, the steps are always told in factory order, and the fact auditor is told the preview is intended.
- **Hooks** (`ManufacturingHookCandidate`): each cites claim ids. Code flags a hook that cites a missing claim, cites none, says a number not in its cited claims, uses an unsupported superlative or a stock opener; the reviewer's `supported: false` flags it too. A flagged hook is never recommended. If none passes, Part 1 opens plainly. Hook totals are editorial heuristics, not view predictions.
- The writer must open Part 1 with the selected hook, word for word or tightened (`hookOpeningIssues`). Later parts continue the one story.
- **Overrides** (episode page, "How it's told"): *Use this opening* rewrites Part 1 only (`choose-hook`); *Switch pattern* writes a new decision and hooks and rewrites every unproduced part (`switch-pattern`). Both reuse the saved research and plan. Stories written before this get a decision on their next Part 1 rewrite, without new research.
- Each version records `spec.process.creative` (pattern, hook id, hook line).

- The research is stored on `Story.research` and reused for part rewrites and replans, so a retry doesn't pay for the search again.
- Each version stores `spec.process` (the plan and its part) and `spec.quality` (every check, revision and its cost).
- Audit categories: `unsupported-claim`, `temporal`, `missing-connection`, `clarity`, `series-continuity`, `tone` and `too-technical`. A stated fact that contradicts the research is blocking.
- Attention audit (stage `attention`): `weak-opening`, `slow-start`, `unanswered-question`, `filler`, `missing-payoff`, `weak-ending`, `name-dropping`. Always a creative concern, so at most significant: it can trigger a targeted revision or leave the script "needs attention", never block it. Every revision is fact-checked again, and the reviser is told engagement never permits a new fact.
- Unproduced episodes beyond the planned count are removed (`settlePartCount`).

### Storyboard, on-screen hook and sound

- The storyboard is given the story editor's visuals: each stage's look and most watchable moment (`stageVisuals`), the hook's `firstFrameVisual` for shot 1 of Part 1, and a dedicated slow-zoom close-up for the featured stage's payoff. Other parts' shot 1 is asked to be the most striking picture its narration allows.
- It also writes `onScreenHook` (3–6 words, stored in `spec`): Part 1 condenses the hook, later parts say what the video shows. Code checks the length, rejects questions and numbers the narration doesn't say. The render shows it black-on-yellow in the title band for the first 2.6 s (`VIDEO.hookTextMs`), then the series title. Older scripts have none and show the title from the start.
- Each shot gets a `soundEffect` from a fixed set (`SOUND_EFFECTS`: conveyor, press, hiss, pour, …, or none). At render, each effect used and a default instrumental bed are generated once with ElevenLabs (sound effects / music) and kept in the audio library under a key (`sfx:press`, `music:default`); every later render reuses them. Loops fade in and out with their shot; one-shots play from its start. Volumes are in Settings → Audio mix (effects default 30%, music 12%). Music is on by default: "Default bed" uses the generated track, a library track replaces it, "No music" turns it off. A failed generation (plan, provider or budget) is logged and the video renders without that sound.

## The script gate

- **Blocking**: a contradiction with the research, or a missing link a viewer would notice. The script is saved so it can be read, but it can't be approved until it is fixed, regenerated, or the issue is dismissed as a false positive (recorded).
- **Significant**: triggers a targeted revision. If it survives the retry limit, the script is "needs attention" and approving it is an explicit override.
- **Minor**: shown, never triggers a revision.
- Creative concerns can never block. Each issue must quote the script; if the quote is not found, the issue is shown as unverified and downgraded to minor.

Approving an episode only locks its script version; there is no story bible or continuation step.
