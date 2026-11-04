"use client";

import { useState } from "react";
import { Loader2, Plus, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAction } from "@/components/client-helpers";
import { createChannel, updateChannel } from "@/app/actions";
import { ILLUSTRATION_STYLES, QUALITY_PRESETS } from "@/lib/constants";
import { CHANNEL_FORMATS, type ChannelEdit, type ChannelFormat } from "@/lib/schemas/channel";
import { channelStyle } from "@/lib/ai/channel-styles";
import type { Voice } from "@/lib/settings";

type Quality = keyof typeof QUALITY_PRESETS;

function Field({ label, hint, children, htmlFor }: { label: string; hint?: string; children: React.ReactNode; htmlFor?: string }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/** Voice, illustration style, quality and storyboard rules: shared by the create and edit forms. */
function ChannelFields({ c, set, voices, idPrefix }: { c: ChannelEdit; set: (patch: Partial<ChannelEdit>) => void; voices: Voice[]; idPrefix: string }) {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" htmlFor={`${idPrefix}-name`}>
          <Input id={`${idPrefix}-name`} value={c.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. How It's Made Daily" />
        </Field>
        <Field label="Narrator voice">
          <Select value={c.voiceId ?? ""} onValueChange={(v) => set({ voiceId: v || null })}>
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
          <Select value={c.styleKey} onValueChange={(v) => set({ styleKey: v })}>
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
        <Field label="Generation quality" hint={QUALITY_PRESETS[c.quality].description}>
          <Select value={c.quality} onValueChange={(v) => set({ quality: v as Quality })}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(QUALITY_PRESETS) as Quality[]).map((q) => (
                <SelectItem key={q} value={q}>
                  {QUALITY_PRESETS[q].label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>
      <Field
        label="Storyboard rules"
        hint="Optional. How this channel's pictures look: what the shots are of, what is always on screen, what is never drawn. The storyboard follows these ahead of its general rules."
        htmlFor={`${idPrefix}-visuals`}
      >
        <Textarea
          id={`${idPrefix}-visuals`}
          rows={4}
          value={c.profile.visuals}
          onChange={(e) => set({ profile: { ...c.profile, visuals: e.target.value } })}
          placeholder="e.g. Always show the product big in the middle of the frame. Never draw faces."
        />
      </Field>
    </>
  );
}

export function CreateChannelForm({ voices }: { voices: Voice[] }) {
  const [format, setFormat] = useState<ChannelFormat>("PROCESS_EXPLAINER");
  const [c, setC] = useState<ChannelEdit>({ name: "", voiceId: voices[0]?.id ?? null, styleKey: channelStyle("PROCESS_EXPLAINER").defaults.styleKey, quality: "STANDARD", profile: { visuals: "" } });
  const a = useAction();
  const pick = (f: ChannelFormat) => {
    setFormat(f);
    setC({ ...c, styleKey: channelStyle(f).defaults.styleKey });
  };
  return (
    <div className="space-y-4 rounded-xl border bg-card p-5">
      <div className="space-y-1.5">
        <Label>Kind of video</Label>
        <div className="grid gap-2 sm:grid-cols-2">
          {(Object.keys(CHANNEL_FORMATS) as ChannelFormat[]).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => pick(f)}
              aria-pressed={format === f}
              className={`rounded-lg border p-3 text-left text-sm ${format === f ? "border-primary bg-primary/5" : "hover:bg-muted"}`}
            >
              <span className="font-medium">{CHANNEL_FORMATS[f].label}</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">{CHANNEL_FORMATS[f].description}</span>
            </button>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">Sets how the shots are storyboarded, which sound effects and music it gets, and how its post text reads. It can&apos;t be changed later.</p>
      </div>
      <ChannelFields c={c} set={(p) => setC({ ...c, ...p })} voices={voices} idPrefix="new" />
      <Button disabled={a.pending || c.name.trim().length < 2} onClick={() => a.run(() => createChannel({ ...c, format }))}>
        {a.pending ? <Loader2 className="animate-spin" /> : <Plus />} Add channel
      </Button>
    </div>
  );
}

export function ChannelEditor({ channelId, initial, voices }: { channelId: string; initial: ChannelEdit; voices: Voice[] }) {
  const [c, setC] = useState(initial);
  const a = useAction();
  return (
    <div className="space-y-6">
      <section className="space-y-4 rounded-xl border bg-card p-5">
        <div>
          <h2 className="text-sm font-semibold">Production</h2>
          <p className="text-xs text-muted-foreground">Applies to scripts you paste from now on.</p>
        </div>
        <ChannelFields c={c} set={(p) => setC({ ...c, ...p })} voices={voices} idPrefix="ch" />
      </section>
      <div className="sticky bottom-4 flex justify-end">
        <Button onClick={() => a.run(() => updateChannel(channelId, c), { success: "Channel saved" })} disabled={a.pending} className="shadow-md">
          {a.pending ? <Loader2 className="animate-spin" /> : <Save />} Save channel
        </Button>
      </div>
    </div>
  );
}
