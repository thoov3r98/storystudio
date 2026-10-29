"use client";

import { useState } from "react";
import { Lightbulb, Loader2, Shuffle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useAction } from "@/components/client-helpers";
import { pitchIdeas } from "@/app/actions";

export type GenerateChannel = {
  id: string;
  name: string;
  format: "CHARACTER_STORY" | "PROCESS_EXPLAINER";
  examples: string[];
  minParts: number;
  maxParts: number;
  hero: string | null;
};

export function GenerateForm({ channel }: { channel: GenerateChannel }) {
  const [idea, setIdea] = useState("");
  const [mode, setMode] = useState<"idea" | "surprise" | null>(null);
  const a = useAction();
  const process = channel.format === "PROCESS_EXPLAINER";
  const go = (withIdea: boolean) => {
    setMode(withIdea ? "idea" : "surprise");
    a.run(() => pitchIdeas(channel.id, withIdea ? idea : null));
  };
  const parts = channel.minParts === channel.maxParts ? `${channel.minParts}` : `${channel.minParts}–${channel.maxParts}`;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,18rem)]">
      <div className="space-y-3 rounded-xl border bg-card p-5">
        <Label htmlFor="idea">{process ? "Which product?" : `What does ${channel.hero ?? "the hero"} face this time?`}</Label>
        <Textarea
          id="idea"
          value={idea}
          onChange={(e) => setIdea(e.target.value)}
          rows={3}
          placeholder={`e.g. ${channel.examples[0] ?? (process ? "Crayons" : "The power grid goes down")}`}
        />
        {channel.examples.length ? (
          <div className="flex flex-wrap gap-2">
            {channel.examples.map((ex) => (
              <button key={ex} type="button" onClick={() => setIdea(ex)} className="rounded-full border px-3 py-1 text-left text-xs text-muted-foreground hover:bg-muted">
                {ex}
              </button>
            ))}
          </div>
        ) : null}
        <div className="flex flex-wrap gap-2 pt-2">
          <Button onClick={() => go(true)} disabled={a.pending || !idea.trim()}>
            {a.pending && mode === "idea" ? <Loader2 className="animate-spin" /> : <Lightbulb />} Pitch this idea
          </Button>
          <Button variant="outline" onClick={() => go(false)} disabled={a.pending}>
            {a.pending && mode === "surprise" ? <Loader2 className="animate-spin" /> : <Shuffle />} Surprise me
          </Button>
        </div>
      </div>
      <aside className="h-fit space-y-2 rounded-xl border bg-card p-5 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">What happens next</p>
        <ol className="ml-4 list-decimal space-y-1.5">
          <li>Three pitches for {channel.name} (a few cents).</li>
          <li>You pick one.{process ? " The product's real manufacturing process is researched on the web." : ""}</li>
          <li>The story is planned across {parts} videos and every script is written and checked.</li>
          <li>Each part waits for your approval before images, narration and rendering.</li>
        </ol>
      </aside>
    </div>
  );
}
