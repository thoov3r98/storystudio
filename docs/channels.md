# Channels and pasted scripts

The studio is organised around TikTok channels. Since November 2026 you write the narration yourself: paste a script, choose how many videos to split it into, and the studio storyboards, illustrates, narrates and renders it. AI script writing (pitches, Topic Research, web research, the creative plan, narration, fact-checks and rewrites) was removed then, along with its tables (migration `20261106120000_paste_scripts`).

## What a channel is

A `Channel` row holds:

- **Format.** Picks the channel's style (`src/lib/ai/channel-styles.ts`). It is chosen when the channel is set up and can't be changed after.
  - `PROCESS_EXPLAINER`, *How it's made*: factory stages, with the material as the star of every shot.
  - `INVISIBLE_EXPLAINER`, *What happens when…*: cutaway and x-ray views of the hidden journey behind an everyday moment, with a dive-in first shot.
- **Storyboard rules** (`profile.visuals`, optional). They are added to every storyboard prompt ahead of the style's general shot rules. Older profiles also hold writing rules; those are ignored.
- **Production settings:** voice, illustration style and quality (the storyboard model and image quality).

Each style gives the storyboard's role, its visual facts, shot rules, camera moves, step labels, first shot and on-screen hook examples, plus whether a question is allowed. It also sets the sound effects the storyboard may pick, a generated music bed (`music:default`, `music:invisible`), and the post text's hashtags and cover. To add a kind of channel, add a `ChannelFormat` value (migration), a `CHANNEL_FORMATS` label and a style object.

## Making videos

```
Make Videos → channel → script + number of videos (+ notes for the pictures, title, hook text)
  live estimate: words ÷ the voice's pace (measured from its recent voiceovers, pauses trimmed
  to the render's longest pause, times narration speed; 2.5 words/s until measured) → length per video and cost
→ Story (sourceScript, visualNotes, plannedParts = N) with empty Parts 1..N
→ script-job (src/lib/pipeline/paste.ts)
    split    N > 1: script_split returns the sentence numbers where Parts 2..N start, plus a series title.
             Code cuts at whole sentences (splitSentences / cutParts in src/lib/script.ts) and saves each
             part's text on Episode.script. Breaks must be increasing and no part may be under half
             the average; after 3 bad answers the split falls back to evenBreaks (equal by length).
    storyboard  Part 1 first; Parts 2..N in parallel with Part 1's visualState, so the look carries on.
             Each sees its narration, the whole script as context, the channel's rules and your notes.
             Returns title, summary, visualState, onScreenHook and the shots (one picture every 4–7 s).
             storyboardIssues checks the shots are the narration word for word, plus numbering, motion,
             step labels and the style's sounds; recutExactly then restores your punctuation and capitals.
    → each part saved as version 1 (reason "pasted"), status SCRIPTED
→ one episode-job { action: "render" } per part: images → voiceover → sync → render → post text
```

Your title and hook overrides replace the drafted ones; the hook override applies to Part 1. Retrying the script job keeps the split and every finished storyboard.

## Editing a video

On the episode page:

- **Edit shot:** change a shot's narration and what its picture shows. This forks a version, then renders. A new picture description redraws only that shot; new words record a new voiceover and captions.
- **Edit title & hook text:** forks the version with a new title and on-screen hook, then re-renders. Nothing else is regenerated.
- **Regenerate image** redraws a shot from the same description. **Regenerate** voiceover records it again. **Re-render with current settings** applies changed audio-mix settings.

Approval works as before: approved versions are locked, edits fork a draft, and earlier parts must be approved first.
