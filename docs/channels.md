# Channels

The studio is organised around TikTok channels (October 2026). Every channel is a researched explainer: something real, researched on the web, told step by step. How a channel's videos are researched, written, checked and storyboarded comes from its **writing style** (below). Character stories (Kenny vs the World) were removed in November 2026.

## What a channel is

A `Channel` row has a **format**, a **profile** and production defaults:

- **Format.** Picks the channel's writing style (`src/lib/ai/writing-styles.ts`), chosen when the channel is set up and fixed after:
  - `PROCESS_EXPLAINER`, *How it's made*: a factory process across a few videos, unseen third-person narrator, factory order.
  - `INVISIBLE_EXPLAINER`, *What happens when…* (November 2026): the hidden journey behind an everyday moment (coffee in your body, where your flush goes, a card tap), one standalone 30–45 s video, second person ("you"), opening on the most surprising moment, cutaway storyboard.
- **Profile.** Summary, subjects, voice, shape, a never-list, Surprise me guidance, example ideas and **storyboard** rules (`visuals`, November 2026; older profiles read it as empty). `channelBlock()` puts the profile into every pitching, writing, checking and scene-rewrite prompt; `channelVisualsBlock()` puts the storyboard rules into the storyboard prompt, ahead of the style's general shot rules.
- **Production.** Voice, illustration style, length per video, parts range (`minParts`..`maxParts`) and quality.

A new channel is set up from a kind (format) and a prompt: one model call (`channelDesignPrompt`, worded for the style) drafts the profile, and the producer edits it. The style's defaults set the illustration style, length and parts (a one-video style always gets 1–1 parts).

## Writing styles (`src/lib/ai/writing-styles.ts`)

One object per format holds everything that differs between kinds of channel; the pipeline is shared. Each style gives:

- research instructions (what to look for, which sources) and how stages are split and ordered;
- the narrator's voice, the plan rules, how a video opens (with and without an approved hook), the body rules and the ending;
- its wording of the three storytelling patterns (the keys are database values and stay `TRANSFORMATION`, `HIDDEN_PROBLEM`, `FACTORY_REVEAL`; *What happens when…* calls them Journey, Hidden problem and Inside reveal) and its own hook strategies;
- the fact-check and attention-check rules that depend on the voice (e.g. "you" is a tone issue for How it's made and intended for What happens when…);
- the storyboard: role, visual facts, shot rules, camera moves, step labels, first shot, on-screen hook examples, and whether a question is allowed;
- its sound effects (the storyboard may only pick these) and its own generated music bed (`music:default`, `music:invisible`);
- the post text's hashtags and cover;
- whether Surprise me and Topic Research use the manufacturing reference library (How it's made only; What happens when… uses the pitch writer).

Single-video stories: the narration, checks and storyboard don't mention parts, the hook may feature any stage, and the render shows no part pill. To add a kind of channel: add a `ChannelFormat` value (migration), a `CHANNEL_FORMATS` label and a style object.

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
- It also writes `onScreenHook` (3–6 words, stored in `spec`): Part 1 says the spoken hook's promise in fewer words, later parts the most surprising thing they show. One `*phrase*` is highlighted. Code checks the length, the highlight, and numbers the narration doesn't say; a question is allowed only with the looser opening. The render pops the words in one by one (outlined white, the highlight on yellow) and holds them while the spoken line plays, 2.2–4.5 s (`VIDEO.hookTextMs`). Older scripts have none and show the title from the start.
- Each shot gets a `stepLabel` (2–4 plain words, shared by consecutive shots of one step). After the hook the title band shows "PART n OF N", the series title small, and the current step big, changing as the process moves on. Versions without step labels show the series title big.
- Each shot gets a `soundEffect` from a fixed set (`SOUND_EFFECTS`: conveyor, press, hiss, pour, …, or none). At render, each effect used and a default instrumental bed are generated once with ElevenLabs (sound effects / music) and kept in the audio library under a key (`sfx:press`, `music:default`); every later render reuses them. Loops fade in and out with their shot; one-shots play from its start. Volumes are in Settings → Audio mix (effects default 30%, music 12%). Music is on by default: "Default bed" uses the generated track, a library track replaces it, "No music" turns it off. A failed generation (plan, provider or budget) is logged and the video renders without that sound.

### Pictures

- New versions draw square art (`EpisodeVersion.imageShape = "square"`, 1024×1024) shown 1080×1080 between the title band and the captions. Versions written before November 2026 stay landscape (1536×1024) in the bands layout; a fork keeps its source's shape.
- Each shot shows its whole picture with one continuous camera move, never a cut within the shot: zooms push toward (or pull back from) the main action, pans drift across, "still" breathes in slightly. The image check reports where the action sits (`review.focus`, fractions of width and height); pictures without it (older, or check off/failed) centre the move just above the middle (`imageFocus`). New angles come only from new pictures.
- The "Machines and materials up close" style (`object-focus`) makes the machine and material the subject; people only as hands or for scale. Pick it per channel.
- The "Cutaway: the invisible made visible" style (`invisible-cutaway`, default for What happens when…) opens up bodies, pipes and machines in cutaway and x-ray views; the subject the video follows glows electric cyan in every shot.

### Looser opening (per channel)

Off by default. When on, Part 1's opening line(s) may say "you" and be one genuine question the video answers; everything after stays third person. It outranks the channel's voice rules for the opening only, and the writer, hook writer, fact-checker and attention check are all told. Recorded on each version (`spec.process.creative.looseOpening`) for comparison.

### Posting and results

- After each render, the fast model writes the post text (`EpisodeVersion.postCopy`): caption, hashtags, a cover shot with cover text, and a pinned comment with one extra fact from the research. Code checks hashtag form, the cover shot and numbers nobody said. Shown on the episode page with copy buttons and "Write again".
- Entering a published episode's numbers (story page) also adds the video to the reference library ("our own video", keyed by its link) with a dated observation, so topic discovery learns from our own results.
- The Quality page compares published videos by story pattern, kind of opening, opening tone, drawing style, picture size, length and part.

## The script gate

- **Blocking**: a contradiction with the research, or a missing link a viewer would notice. The script is saved so it can be read, but it can't be approved until it is fixed, regenerated, or the issue is dismissed as a false positive (recorded).
- **Significant**: triggers a targeted revision. If it survives the retry limit, the script is "needs attention" and approving it is an explicit override.
- **Minor**: shown, never triggers a revision.
- Creative concerns can never block. Each issue must quote the script; if the quote is not found, the issue is shown as unverified and downgraded to minor.

Approving an episode only locks its script version; there is no story bible or continuation step.
