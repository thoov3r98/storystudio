"use client";

import { useState } from "react";
import { Loader2, Paintbrush, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAction } from "@/components/client-helpers";
import { createCharacter, drawCharacter, updateCharacter } from "@/app/actions";
import type { Voice } from "@/lib/settings";

const BRIEF_EXAMPLES = [
  "A big, friendly ex-trucker who keeps getting stranded and talks his way through it",
  "A nervous first-time traveller who over-prepares for everything and still gets caught out",
  "A retired paramedic grandma who stays calm in every everyday emergency",
];

export function CreateCharacterForm() {
  const [brief, setBrief] = useState("");
  const a = useAction();
  return (
    <div className="space-y-3 rounded-xl border bg-card p-5">
      <div>
        <Label htmlFor="brief">Describe a character</Label>
        <p className="text-xs text-muted-foreground">A sentence or two is enough. You can edit everything before drawing them.</p>
      </div>
      <Textarea id="brief" value={brief} onChange={(e) => setBrief(e.target.value)} rows={3} placeholder={`e.g. ${BRIEF_EXAMPLES[0]}`} />
      <div className="flex flex-wrap gap-2">
        {BRIEF_EXAMPLES.map((ex) => (
          <button key={ex} type="button" onClick={() => setBrief(ex)} className="rounded-full border px-3 py-1 text-left text-xs text-muted-foreground hover:bg-muted">
            {ex}
          </button>
        ))}
      </div>
      <Button disabled={a.pending || brief.trim().length < 3} onClick={() => a.run(() => createCharacter(brief))}>
        {a.pending ? <Loader2 className="animate-spin" /> : <Sparkles />}
        {a.pending ? "Designing… (about 20 seconds)" : "Design character"}
      </Button>
    </div>
  );
}

export function DrawSheetButton({ characterId, hasSheet }: { characterId: string; hasSheet: boolean }) {
  const a = useAction();
  return (
    <Button
      variant={hasSheet ? "outline" : "default"}
      size="sm"
      disabled={a.pending}
      onClick={() => a.run(() => drawCharacter(characterId), { success: "Character drawn" })}
    >
      {a.pending ? <Loader2 className="animate-spin" /> : <Paintbrush />}
      {a.pending ? "Drawing… (about a minute)" : hasSheet ? "Redraw" : "Draw character"}
    </Button>
  );
}

type Editable = {
  name: string;
  tagline: string;
  personality: string;
  backstory: string;
  speakingStyle: string;
  visualDescription: string;
  signatureColor: string;
  perspective: "FIRST_PERSON" | "THIRD_PERSON";
  voiceId: string | null;
};

function Field({ label, hint, children, htmlFor }: { label: string; hint?: string; children: React.ReactNode; htmlFor?: string }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export function CharacterEditor({ characterId, initial, voices }: { characterId: string; initial: Editable; voices: Voice[] }) {
  const [c, setC] = useState(initial);
  const a = useAction();
  const set = <K extends keyof Editable>(k: K, v: Editable[K]) => setC({ ...c, [k]: v });
  return (
    <div className="space-y-4 rounded-xl border bg-card p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" htmlFor="c-name">
          <Input id="c-name" value={c.name} onChange={(e) => set("name", e.target.value)} />
        </Field>
        <Field label="Signature colour" hint="Their clothing accent, and the video's title and caption bands.">
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={c.signatureColor}
              onChange={(e) => set("signatureColor", e.target.value.toUpperCase())}
              className="h-9 w-12 cursor-pointer rounded border bg-transparent"
              aria-label="Signature colour"
            />
            <Input value={c.signatureColor} onChange={(e) => set("signatureColor", e.target.value)} className="font-mono text-xs" />
          </div>
        </Field>
      </div>
      <Field label="Tagline" htmlFor="c-tagline">
        <Input id="c-tagline" value={c.tagline} onChange={(e) => set("tagline", e.target.value)} />
      </Field>
      <Field label="Personality" htmlFor="c-personality">
        <Textarea id="c-personality" value={c.personality} onChange={(e) => set("personality", e.target.value)} rows={2} />
      </Field>
      <Field label="Background" htmlFor="c-backstory">
        <Textarea id="c-backstory" value={c.backstory} onChange={(e) => set("backstory", e.target.value)} rows={3} />
      </Field>
      <Field label="How they talk" htmlFor="c-speaking" hint="Shapes the narration's voice and phrasing.">
        <Textarea id="c-speaking" value={c.speakingStyle} onChange={(e) => set("speakingStyle", e.target.value)} rows={2} />
      </Field>
      <Field label="Look" htmlFor="c-visual" hint="Used for the character sheet and every scene. Redraw after changing it.">
        <Textarea id="c-visual" value={c.visualDescription} onChange={(e) => set("visualDescription", e.target.value)} rows={3} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Narration">
          <Select value={c.perspective} onValueChange={(v) => set("perspective", v as Editable["perspective"])}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="FIRST_PERSON">First person (“I…”)</SelectItem>
              <SelectItem value="THIRD_PERSON">Third person (“he / she…”)</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label="Voice" hint={voices.length ? undefined : "Add narrator voices in Settings first."}>
          <Select value={c.voiceId ?? "none"} onValueChange={(v) => set("voiceId", v === "none" ? null : v)}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Use the batch’s voice</SelectItem>
              {voices.map((v) => (
                <SelectItem key={v.id} value={v.id}>
                  {v.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>
      <Button size="sm" disabled={a.pending} onClick={() => a.run(() => updateCharacter(characterId, c), { success: "Character saved" })}>
        {a.pending ? <Loader2 className="animate-spin" /> : null}
        Save character
      </Button>
    </div>
  );
}
