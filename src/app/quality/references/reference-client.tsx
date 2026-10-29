"use client";

import { useState } from "react";
import { Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ActionButton, useAction } from "@/components/client-helpers";
import { ARCHETYPES, ENDING_TYPES, HOOK_STYLES } from "@/lib/schemas/story-plan";
import { deleteReferenceStory, saveReferenceStory, setReferenceActive } from "@/app/actions";

const EMPTY = { title: "", text: "", archetype: "survival", hookStyle: "immediate-danger", endingType: "resolution", structure: "", tone: "", pacing: "", qualities: "" };

function Choice({ id, label, value, options, onChange }: { id: string; label: string; value: string; options: readonly string[]; onChange: (v: string) => void }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={id} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o} value={o}>
              {o.replaceAll("-", " ")}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

export function ReferenceForm() {
  const [f, setF] = useState(EMPTY);
  const { pending, run } = useAction();
  const set = (k: keyof typeof EMPTY) => (v: string) => setF({ ...f, [k]: v });
  return (
    <div className="space-y-4 rounded-xl border bg-card p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="ref-title">Title</Label>
          <Input id="ref-title" value={f.title} onChange={(e) => set("title")(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ref-tone">Tone</Label>
          <Input id="ref-tone" value={f.tone} onChange={(e) => set("tone")(e.target.value)} placeholder="e.g. tense, dry" />
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="ref-text">Script or transcript</Label>
        <Textarea id="ref-text" rows={7} value={f.text} onChange={(e) => set("text")(e.target.value)} />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Choice id="ref-arch" label="Story type" value={f.archetype} options={ARCHETYPES} onChange={set("archetype")} />
        <Choice id="ref-hook" label="Hook style" value={f.hookStyle} options={HOOK_STYLES} onChange={set("hookStyle")} />
        <Choice id="ref-end" label="Ending" value={f.endingType} options={ENDING_TYPES} onChange={set("endingType")} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="ref-structure">Shape (optional)</Label>
          <Input id="ref-structure" value={f.structure} onChange={(e) => set("structure")(e.target.value)} placeholder="e.g. Clue → wrong suspect → stakeout → reveal" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="ref-qualities">What it does well (comma separated)</Label>
          <Input id="ref-qualities" value={f.qualities} onChange={(e) => set("qualities")(e.target.value)} placeholder="e.g. fair clues, earned ending" />
        </div>
      </div>
      <Button
        disabled={pending}
        onClick={() =>
          run(
            () =>
              saveReferenceStory(null, {
                ...f,
                archetype: f.archetype as (typeof ARCHETYPES)[number],
                hookStyle: f.hookStyle as (typeof HOOK_STYLES)[number],
                endingType: f.endingType as (typeof ENDING_TYPES)[number],
                qualities: f.qualities
                  .split(",")
                  .map((q) => q.trim())
                  .filter(Boolean),
              }),
            { success: "Reference added", onSuccess: () => setF(EMPTY) },
          )
        }
      >
        {pending ? <Loader2 className="animate-spin" /> : null} Add reference
      </Button>
    </div>
  );
}

export function ReferenceRowActions({ id, active }: { id: string; active: boolean }) {
  return (
    <div className="flex gap-1">
      <ActionButton size="xs" variant="outline" action={() => setReferenceActive(id, !active)} success={active ? "Paused" : "Resumed"}>
        {active ? "Pause" : "Use again"}
      </ActionButton>
      <ActionButton
        size="xs"
        variant="ghost"
        action={() => deleteReferenceStory(id)}
        success="Deleted"
        confirm={{ title: "Delete this reference?", description: "The writer will stop using it. This can't be undone.", confirmLabel: "Delete" }}
      >
        <Trash2 />
      </ActionButton>
    </div>
  );
}
