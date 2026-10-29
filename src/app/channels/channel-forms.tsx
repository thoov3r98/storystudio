"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2, Plus, Save, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAction } from "@/components/client-helpers";
import { createChannel, updateChannel } from "@/app/actions";
import { ILLUSTRATION_STYLES, QUALITY_PRESETS, TARGET_DURATIONS } from "@/lib/constants";
import type { ChannelProfile } from "@/lib/schemas/channel";
import type { Voice } from "@/lib/settings";

const BRIEF_EXAMPLES = [
  "A grandma who tries a different job every week and tells us how it went. Warm, funny, everyday life.",
  "How famous foods are made in the factory, step by step, strictly factual.",
];

export function CreateChannelForm() {
  const [brief, setBrief] = useState("");
  const a = useAction();
  return (
    <div className="space-y-3 rounded-xl border bg-card p-5">
      <div>
        <Label htmlFor="brief">Describe a new channel</Label>
        <p className="text-xs text-muted-foreground">
          What the videos are about, who (if anyone) they star, and how they should sound. Its profile is written from this, and you can edit all of it.
        </p>
      </div>
      <Textarea id="brief" value={brief} onChange={(e) => setBrief(e.target.value)} rows={5} placeholder={`e.g. ${BRIEF_EXAMPLES[0]}`} />
      <div className="flex flex-wrap gap-2">
        {BRIEF_EXAMPLES.map((ex) => (
          <button key={ex} type="button" onClick={() => setBrief(ex)} className="rounded-full border px-3 py-1 text-left text-xs text-muted-foreground hover:bg-muted">
            {ex}
          </button>
        ))}
      </div>
      <Button disabled={a.pending || brief.trim().length < 10} onClick={() => a.run(() => createChannel(brief))}>
        {a.pending ? <Loader2 className="animate-spin" /> : <Sparkles />}
        {a.pending ? "Setting up… (about 20 seconds)" : "Set up channel"}
      </Button>
    </div>
  );
}

type Editable = {
  name: string;
  characterId: string | null;
  perspective: "FIRST_PERSON" | "THIRD_PERSON";
  voiceId: string | null;
  styleKey: string;
  targetDurationSec: number;
  minParts: number;
  maxParts: number;
  quality: keyof typeof QUALITY_PRESETS;
  profile: ChannelProfile;
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

/** One editable line per item, for the never-list and the examples. */
function ListEditor({ id, items, onChange, placeholder }: { id: string; items: string[]; onChange: (items: string[]) => void; placeholder: string }) {
  return (
    <div className="space-y-2">
      {items.map((item, i) => (
        <div key={i} className="flex gap-2">
          <Input id={i === 0 ? id : undefined} value={item} onChange={(e) => onChange(items.map((x, k) => (k === i ? e.target.value : x)))} />
          <Button variant="ghost" size="icon" aria-label="Remove" onClick={() => onChange(items.filter((_, k) => k !== i))}>
            <X />
          </Button>
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={() => onChange([...items, ""])}>
        <Plus /> {placeholder}
      </Button>
    </div>
  );
}

export function ChannelEditor({
  channelId,
  format,
  initial,
  voices,
  characters,
}: {
  channelId: string;
  format: "CHARACTER_STORY" | "PROCESS_EXPLAINER";
  initial: Editable;
  voices: Voice[];
  characters: { id: string; name: string }[];
}) {
  const [c, setC] = useState(initial);
  const a = useAction();
  const set = <K extends keyof Editable>(k: K, v: Editable[K]) => setC({ ...c, [k]: v });
  const setProfile = <K extends keyof ChannelProfile>(k: K, v: ChannelProfile[K]) => setC({ ...c, profile: { ...c.profile, [k]: v } });
  const story = format === "CHARACTER_STORY";
  const save = () =>
    a.run(
      () =>
        updateChannel(channelId, {
          ...c,
          profile: { ...c.profile, avoid: c.profile.avoid.map((x) => x.trim()).filter(Boolean), examples: c.profile.examples.map((x) => x.trim()).filter(Boolean) },
        }),
      { success: "Channel saved" },
    );
  const parts = [1, 2, 3, 4, 5, 6];

  return (
    <div className="space-y-6">
      <section className="space-y-4 rounded-xl border bg-card p-5">
        <h2 className="text-sm font-semibold">Production</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" htmlFor="ch-name">
            <Input id="ch-name" value={c.name} onChange={(e) => set("name", e.target.value)} />
          </Field>
          {story ? (
            <Field label="Character" hint="The hero of every story on this channel.">
              <Select value={c.characterId ?? ""} onValueChange={(v) => set("characterId", v || null)}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Choose a character" />
                </SelectTrigger>
                <SelectContent>
                  {characters.map((ch) => (
                    <SelectItem key={ch.id} value={ch.id}>
                      {ch.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {characters.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  <Link href="/characters" className="underline">
                    Design a character
                  </Link>{" "}
                  first.
                </p>
              ) : null}
            </Field>
          ) : null}
          {story ? (
            <Field label="Who narrates">
              <Select value={c.perspective} onValueChange={(v) => set("perspective", v as Editable["perspective"])}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="THIRD_PERSON">An unseen narrator (third person)</SelectItem>
                  <SelectItem value="FIRST_PERSON">The character (first person)</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          ) : null}
          <Field label="Narrator voice">
            <Select value={c.voiceId ?? ""} onValueChange={(v) => set("voiceId", v || null)}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Choose a voice" />
              </SelectTrigger>
              <SelectContent>
                {voices.map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Illustration style">
            <Select value={c.styleKey} onValueChange={(v) => set("styleKey", v)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(ILLUSTRATION_STYLES).map(([key, s]) => (
                  <SelectItem key={key} value={key}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Length of each video">
            <div className="grid grid-cols-3 gap-2">
              {TARGET_DURATIONS.map((d) => (
                <Button key={d} type="button" variant={c.targetDurationSec === d ? "default" : "outline"} onClick={() => set("targetDurationSec", d)}>
                  {d}s
                </Button>
              ))}
            </div>
          </Field>
          <Field label="Videos per story" hint="The planner picks how many within this range, based on how much there is to tell.">
            <div className="flex items-center gap-2">
              <Select value={String(c.minParts)} onValueChange={(v) => set("minParts", Number(v))}>
                <SelectTrigger className="w-20" aria-label="Fewest parts">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {parts.map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <span className="text-sm text-muted-foreground">to</span>
              <Select value={String(c.maxParts)} onValueChange={(v) => set("maxParts", Number(v))}>
                <SelectTrigger className="w-20" aria-label="Most parts">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {parts.map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </Field>
          <Field label="Generation quality" hint={QUALITY_PRESETS[c.quality].description}>
            <Select value={c.quality} onValueChange={(v) => set("quality", v as Editable["quality"])}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(QUALITY_PRESETS) as Editable["quality"][]).map((q) => (
                  <SelectItem key={q} value={q}>
                    {QUALITY_PRESETS[q].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
      </section>

      <section className="space-y-4 rounded-xl border bg-card p-5">
        <div>
          <h2 className="text-sm font-semibold">Profile</h2>
          <p className="text-xs text-muted-foreground">Every pitch, script and check for this channel follows these rules. Changes apply to scripts written from now on.</p>
        </div>
        <Field label="In one sentence" htmlFor="ch-summary">
          <Input id="ch-summary" value={c.profile.summary} onChange={(e) => setProfile("summary", e.target.value)} />
        </Field>
        <Field label="What the videos are about" htmlFor="ch-subjects">
          <Textarea id="ch-subjects" rows={3} value={c.profile.subjects} onChange={(e) => setProfile("subjects", e.target.value)} />
        </Field>
        <Field label="Voice" hint="Who narrates, the tone, and what the narration never does." htmlFor="ch-voice">
          <Textarea id="ch-voice" rows={4} value={c.profile.voice} onChange={(e) => setProfile("voice", e.target.value)} />
        </Field>
        <Field label="Shape" hint="How each story runs across its parts, and the clarity rules." htmlFor="ch-structure">
          <Textarea id="ch-structure" rows={5} value={c.profile.structure} onChange={(e) => setProfile("structure", e.target.value)} />
        </Field>
        <Field label="Never" htmlFor="ch-avoid">
          <ListEditor id="ch-avoid" items={c.profile.avoid} onChange={(v) => setProfile("avoid", v)} placeholder="Add a rule" />
        </Field>
        <Field label="Surprise me" hint="How fresh ideas are picked when you don't give one." htmlFor="ch-surprise">
          <Textarea id="ch-surprise" rows={3} value={c.profile.surpriseMe} onChange={(e) => setProfile("surpriseMe", e.target.value)} />
        </Field>
        <Field label="Example ideas" htmlFor="ch-examples">
          <ListEditor id="ch-examples" items={c.profile.examples} onChange={(v) => setProfile("examples", v)} placeholder="Add an example" />
        </Field>
      </section>

      <div className="sticky bottom-4 flex justify-end">
        <Button onClick={save} disabled={a.pending} className="shadow-md">
          {a.pending ? <Loader2 className="animate-spin" /> : <Save />} Save channel
        </Button>
      </div>
    </div>
  );
}
