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
import type { ChannelEdit } from "@/lib/schemas/channel";
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

/** Voice, illustration style, quality and description: shared by the create and edit forms. */
function ChannelFields({ c, set, voices, idPrefix }: { c: ChannelEdit; set: (patch: Partial<ChannelEdit>) => void; voices: Voice[]; idPrefix: string }) {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" htmlFor={`${idPrefix}-name`}>
          <Input id={`${idPrefix}-name`} value={c.name} onChange={(e) => set({ name: e.target.value })} placeholder="e.g. The Invisible World" />
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
        label="Describe this channel"
        hint="Optional. What its videos show and how they look: what the shots are of, what is always on screen, what is never drawn. The storyboard follows this ahead of its general rules."
        htmlFor={`${idPrefix}-visuals`}
      >
        <Textarea
          id={`${idPrefix}-visuals`}
          rows={4}
          value={c.profile.visuals}
          onChange={(e) => set({ profile: { ...c.profile, visuals: e.target.value } })}
          placeholder="e.g. Everyday science explained with cutaway pictures. Always show the subject big in the middle of the frame. Never draw faces."
        />
      </Field>
    </>
  );
}

export function CreateChannelForm({ voices }: { voices: Voice[] }) {
  const [c, setC] = useState<ChannelEdit>({ name: "", voiceId: voices[0]?.id ?? null, styleKey: channelStyle("CUSTOM").defaults.styleKey, quality: "STANDARD", profile: { visuals: "" } });
  const a = useAction();
  return (
    <div className="space-y-4 rounded-xl border bg-card p-5">
      <ChannelFields c={c} set={(p) => setC({ ...c, ...p })} voices={voices} idPrefix="new" />
      <Button disabled={a.pending || c.name.trim().length < 2} onClick={() => a.run(() => createChannel(c))}>
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
