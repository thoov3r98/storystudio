"use client";

import { useMemo, useState } from "react";
import { Clapperboard, Loader2, Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/components/client-helpers";
import { createFromScript } from "@/app/actions";
import { estimateScriptCost, formatUsd, type ModelNames } from "@/lib/costs/estimate";
import type { Pricing } from "@/lib/costs/pricing";
import { cleanScript, COMFORTABLE_PART_SEC, cutParts, evenBreaks, MAX_PARTS, splitSentences } from "@/lib/script";
import { countWords, estimateSpokenDuration } from "@/lib/text";
import type { Quality } from "@/generated/prisma/enums";

export type GenerateChannel = {
  id: string;
  name: string;
  quality: Quality;
  /** Words per second as the video plays, for this channel's voice. */
  wordsPerSecond: number;
  /** True when the pace was measured from this voice's earlier voiceovers. */
  measured: boolean;
};

function fmtSec(sec: number) {
  const s = Math.round(sec);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function GenerateForm({ channel, pricing, models }: { channel: GenerateChannel; pricing: Pricing; models: ModelNames }) {
  const [script, setScript] = useState("");
  const [parts, setParts] = useState(1);
  const [visualNotes, setVisualNotes] = useState("");
  const [title, setTitle] = useState("");
  const [hook, setHook] = useState("");
  const a = useAction();

  const est = useMemo(() => {
    const text = cleanScript(script);
    const words = countWords(text);
    const sentences = splitSentences(text);
    const totalSec = estimateSpokenDuration(text, channel.wordsPerSecond);
    // A rough preview by length; the real split picks natural break points near these.
    const preview = sentences.length >= parts ? cutParts(sentences, evenBreaks(sentences, parts)).map((t) => estimateSpokenDuration(t, channel.wordsPerSecond)) : [];
    const cost = estimateScriptCost(pricing, models, { words, parts, wordsPerSecond: channel.wordsPerSecond, quality: channel.quality });
    const suggested = Math.min(MAX_PARTS, Math.max(1, Math.round(totalSec / 60)));
    return { words, sentences: sentences.length, totalSec, perPartSec: totalSec / parts, preview, cost, suggested };
  }, [script, parts, channel, pricing, models]);

  const tooFewSentences = est.words > 0 && est.sentences < parts;
  const [lo, hi] = COMFORTABLE_PART_SEC;
  const lengthNote =
    est.words === 0 ? null : est.perPartSec < lo ? `Each video would be under ${lo}s. Fewer videos might work better.` : est.perPartSec > hi ? `Each video would be over ${hi}s. More videos might work better.` : null;
  const canSubmit = est.words >= 15 && !tooFewSentences && !a.pending;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]">
      <div className="space-y-5 rounded-xl border bg-card p-5">
        <div className="space-y-1.5">
          <Label htmlFor="script">Your script</Label>
          <Textarea
            id="script"
            value={script}
            onChange={(e) => setScript(e.target.value)}
            rows={14}
            className="font-[inherit] leading-relaxed"
            placeholder="Paste the narration exactly as it should be spoken. Every word is kept as you wrote it."
          />
          <p className="text-xs text-muted-foreground">
            {est.words} words · {est.sentences} sentence{est.sentences === 1 ? "" : "s"}
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="parts">Number of videos</Label>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1">
              <Button type="button" size="icon" variant="outline" aria-label="Fewer videos" disabled={parts <= 1} onClick={() => setParts(parts - 1)}>
                <Minus />
              </Button>
              <Input
                id="parts"
                type="number"
                min={1}
                max={MAX_PARTS}
                value={parts}
                onChange={(e) => setParts(Math.min(MAX_PARTS, Math.max(1, Number(e.target.value) || 1)))}
                className="w-16 text-center tabular-nums"
              />
              <Button type="button" size="icon" variant="outline" aria-label="More videos" disabled={parts >= MAX_PARTS} onClick={() => setParts(parts + 1)}>
                <Plus />
              </Button>
            </div>
            {est.words > 0 && est.suggested !== parts ? (
              <button type="button" className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground" onClick={() => setParts(est.suggested)}>
                About a minute each: {est.suggested} video{est.suggested === 1 ? "" : "s"}
              </button>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">{parts > 1 ? "A numbered series (Part 1, Part 2, …). The AI picks natural break points between sentences, close to equal lengths." : "One video from the whole script."}</p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="visual-notes">Notes for the pictures (optional)</Label>
          <Textarea
            id="visual-notes"
            value={visualNotes}
            onChange={(e) => setVisualNotes(e.target.value)}
            rows={2}
            placeholder="e.g. Show the factory machines, not people. Keep it at night."
          />
        </div>

        <details className="rounded-lg border p-3">
          <summary className="cursor-pointer text-sm font-medium">Title and on-screen text (optional)</summary>
          <p className="mt-1 text-xs text-muted-foreground">Left empty, the AI drafts them from your script. You can edit them on each video afterwards.</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="title">{parts > 1 ? "Series title" : "Title"}</Label>
              <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. How Crayons Are Made" maxLength={200} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="hook">Big text over the opening{parts > 1 ? " (Part 1)" : ""}</Label>
              <Input id="hook" value={hook} onChange={(e) => setHook(e.target.value)} placeholder="e.g. Crayons start as *hot liquid*" maxLength={80} />
              <p className="text-xs text-muted-foreground">Wrap a word in *asterisks* to highlight it.</p>
            </div>
          </div>
        </details>

        <Button
          size="lg"
          disabled={!canSubmit}
          onClick={() =>
            a.run(() => createFromScript({ channelId: channel.id, script, parts, visualNotes: visualNotes.trim() || null, title: title.trim() || null, hook: hook.trim() || null }))
          }
        >
          {a.pending ? <Loader2 className="animate-spin" /> : <Clapperboard />}
          Make {parts} video{parts === 1 ? "" : "s"}
          {est.words ? ` · ~${formatUsd(est.cost.total)}` : ""}
        </Button>
        {tooFewSentences ? <p className="text-sm text-destructive">The script has {est.sentences} sentences, too few for {parts} videos.</p> : null}
      </div>

      <aside className="h-fit space-y-4 rounded-xl border bg-card p-5 text-sm" aria-live="polite">
        <div>
          <p className="font-medium">Expected length</p>
          {est.words ? (
            <>
              <p className="mt-1 text-2xl font-semibold tabular-nums">
                {parts > 1 ? `≈ ${fmtSec(est.perPartSec)} each` : `≈ ${fmtSec(est.totalSec)}`}
              </p>
              <p className="text-muted-foreground">
                {parts > 1 ? `${parts} videos · ${fmtSec(est.totalSec)} total` : "1 video"}
                {est.preview.length > 1 ? ` (about ${est.preview.map(fmtSec).join(" / ")})` : ""}
              </p>
              {lengthNote ? <p className="mt-1 text-amber-700">{lengthNote}</p> : null}
            </>
          ) : (
            <p className="mt-1 text-muted-foreground">Paste a script to see how long the videos will be.</p>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            From {channel.name}&apos;s voice at {channel.wordsPerSecond.toFixed(2)} words a second{channel.measured ? ", measured from its earlier videos with long pauses trimmed" : " (a typical pace; it is measured after the first video)"}.
          </p>
        </div>
        {est.words ? (
          <div>
            <p className="font-medium">Estimated cost · {formatUsd(est.cost.total)}</p>
            <ul className="mt-1 space-y-0.5 text-muted-foreground">
              <li>Pictures: {formatUsd(est.cost.images)}</li>
              <li>Voiceover: {formatUsd(est.cost.speech)}</li>
              <li>Rendering: {formatUsd(est.cost.render)}</li>
              <li>Storyboard and post text: {formatUsd(est.cost.text)}</li>
            </ul>
          </div>
        ) : null}
        <div className="text-muted-foreground">
          <p className="font-medium text-foreground">What happens next</p>
          <ol className="ml-4 mt-1 list-decimal space-y-1">
            {parts > 1 ? <li>The script is split into {parts} videos at natural break points. Your words are never changed.</li> : null}
            <li>Each video is storyboarded: shots, pictures, step labels, sounds and the big opening text.</li>
            <li>Pictures, voiceover, captions and the edit are made, and each MP4 renders.</li>
            <li>You review each video. Edit any shot&apos;s words or picture and only that part is redone.</li>
          </ol>
        </div>
      </aside>
    </div>
  );
}
