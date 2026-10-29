"use client";

import { useState } from "react";
import { Download, Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Section } from "@/components/studio";
import { useAction } from "@/components/client-helpers";
import { ILLUSTRATION_STYLES, QUALITY_PRESETS, TARGET_DURATIONS } from "@/lib/constants";
import type { AudioMix, Defaults, Voice, VoiceSettings } from "@/lib/settings";
import { addAudioAsset, importElevenLabsVoices, saveAudioMix, saveDefaults, saveVoices, saveVoiceSettings } from "@/app/actions";

type AudioAssetRow = { id: string; name: string; kind: string; license: string; source: string; attribution: string | null; url: string };

function Card({ children }: { children: React.ReactNode }) {
  return <div className="space-y-4 rounded-xl border bg-card p-5">{children}</div>;
}

function SliderField({ label, value, onChange, min, max, step, format }: { label: string; value: number; onChange: (v: number) => void; min: number; max: number; step: number; format?: (v: number) => string }) {
  return (
    <div className="space-y-2">
      <div className="flex justify-between text-sm">
        <Label>{label}</Label>
        <span className="tabular-nums text-muted-foreground">{format ? format(value) : value.toFixed(2)}</span>
      </div>
      <Slider value={[value]} min={min} max={max} step={step} onValueChange={(v) => onChange(v[0])} aria-label={label} />
    </div>
  );
}

export function SettingsForms(props: {
  voices: Voice[];
  voiceSettings: VoiceSettings;
  audioMix: AudioMix;
  defaults: Defaults;
  audioAssets: AudioAssetRow[];
}) {
  const [voices, setVoices] = useState<Voice[]>(props.voices);
  const [available, setAvailable] = useState<Voice[]>([]);
  const [vs, setVs] = useState(props.voiceSettings);
  const [mix, setMix] = useState(props.audioMix);
  const [defaults, setDefaults] = useState(props.defaults);
  const [asset, setAsset] = useState({ name: "", kind: "MUSIC" as "MUSIC" | "SFX", url: "", license: "", source: "", attribution: "" });
  const a = useAction();

  return (
    <div className="grid gap-10 lg:grid-cols-2">
      <Section title="Narrator voices" description="Voices offered on the Generate page. One narrator per series is recommended.">
        <Card>
          {voices.map((v, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2">
              <Input value={v.name} onChange={(e) => setVoices(voices.map((x, k) => (k === i ? { ...x, name: e.target.value } : x)))} placeholder="Name" />
              <Input value={v.id} onChange={(e) => setVoices(voices.map((x, k) => (k === i ? { ...x, id: e.target.value } : x)))} placeholder="ElevenLabs voice ID" className="font-mono text-xs" />
              <Button variant="ghost" size="icon" onClick={() => setVoices(voices.filter((_, k) => k !== i))} aria-label="Remove voice">
                <Trash2 />
              </Button>
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => setVoices([...voices, { id: "", name: "", description: "" }])}>
              <Plus /> Add voice
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={a.pending}
              onClick={() => a.run(() => importElevenLabsVoices(), { onSuccess: (d) => setAvailable(d ?? []) })}
            >
              <Download /> Load from ElevenLabs
            </Button>
            <Button size="sm" disabled={a.pending} onClick={() => a.run(() => saveVoices(voices.filter((v) => v.id && v.name)), { success: "Voices saved" })}>
              Save voices
            </Button>
          </div>
          {available.length ? (
            <div className="max-h-60 space-y-1 overflow-y-auto rounded-lg border p-2">
              {available.map((v) => (
                <div key={v.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="min-w-0 truncate">
                    {v.name} <span className="text-xs text-muted-foreground">{v.description}</span>
                  </span>
                  <Button size="xs" variant="ghost" disabled={voices.some((x) => x.id === v.id)} onClick={() => setVoices([...voices, v])}>
                    Add
                  </Button>
                </div>
              ))}
            </div>
          ) : null}
        </Card>
      </Section>

      <Section title="Speaking style" description="ElevenLabs voice settings applied to every narration.">
        <Card>
          <SliderField label="Stability" value={vs.stability} onChange={(v) => setVs({ ...vs, stability: v })} min={0} max={1} step={0.05} />
          <SliderField label="Similarity boost" value={vs.similarityBoost} onChange={(v) => setVs({ ...vs, similarityBoost: v })} min={0} max={1} step={0.05} />
          <SliderField label="Style exaggeration" value={vs.style} onChange={(v) => setVs({ ...vs, style: v })} min={0} max={1} step={0.05} />
          <SliderField label="Speed" value={vs.speed} onChange={(v) => setVs({ ...vs, speed: v })} min={0.7} max={1.2} step={0.01} format={(v) => `${v.toFixed(2)}×`} />
          <p className="-mt-2 text-xs text-muted-foreground">ElevenLabs tops out at 1.2×. To go faster, raise Narration speed-up under Audio mix.</p>
          <div className="flex items-center justify-between">
            <Label htmlFor="boost">Speaker boost</Label>
            <Switch id="boost" checked={vs.useSpeakerBoost} onCheckedChange={(c) => setVs({ ...vs, useSpeakerBoost: c })} />
          </div>
          <Button size="sm" disabled={a.pending} onClick={() => a.run(() => saveVoiceSettings(vs), { success: "Voice settings saved" })}>
            Save
          </Button>
        </Card>
      </Section>

      <Section title="Audio mix" description="Applied at render time. Background music is optional.">
        <Card>
          <SliderField
            label="Narration speed-up"
            value={mix.narrationSpeed}
            onChange={(v) => setMix({ ...mix, narrationSpeed: v })}
            min={1}
            max={1.5}
            step={0.05}
            format={(v) => `${v.toFixed(2)}×`}
          />
          <p className="-mt-2 text-xs text-muted-foreground">
            Speeds the narration up in the video without raising its pitch; scenes and captions stay in sync. Overall pace ≈ {(vs.speed * mix.narrationSpeed).toFixed(2)}× a normal
            voice. New scripts are written longer to keep the target length; existing episodes just need a re-render.
          </p>
          <SliderField label="Voiceover volume" value={mix.voiceVolume} onChange={(v) => setMix({ ...mix, voiceVolume: v })} min={0} max={2} step={0.05} format={(v) => `${Math.round(v * 100)}%`} />
          <SliderField label="Background music volume" value={mix.musicVolume} onChange={(v) => setMix({ ...mix, musicVolume: v })} min={0} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} />
          <SliderField label="Sound effects volume" value={mix.sfxVolume} onChange={(v) => setMix({ ...mix, sfxVolume: v })} min={0} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} />
          <div className="space-y-2">
            <Label>Background music track</Label>
            <Select value={mix.musicAssetId ?? "none"} onValueChange={(v) => setMix({ ...mix, musicAssetId: v === "none" ? null : v })}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No music</SelectItem>
                {props.audioAssets
                  .filter((x) => x.kind === "MUSIC")
                  .map((x) => (
                    <SelectItem key={x.id} value={x.id}>
                      {x.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <Button size="sm" disabled={a.pending} onClick={() => a.run(() => saveAudioMix(mix), { success: "Audio mix saved" })}>
            Save
          </Button>
        </Card>
      </Section>

      <Section title="Licensed audio library" description="Only add audio you own, that is public domain, or that you have a license for. Provenance is stored with each file.">
        <Card>
          {props.audioAssets.length ? (
            <ul className="space-y-2 text-sm">
              {props.audioAssets.map((x) => (
                <li key={x.id} className="rounded-lg border p-2">
                  <div className="font-medium">
                    {x.name} <span className="text-xs text-muted-foreground">({x.kind.toLowerCase()})</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {x.license} · {x.source}
                    {x.attribution ? ` · ${x.attribution}` : ""}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">No audio assets.</p>
          )}
          <div className="grid gap-2 sm:grid-cols-2">
            <Input placeholder="Name" value={asset.name} onChange={(e) => setAsset({ ...asset, name: e.target.value })} />
            <Select value={asset.kind} onValueChange={(v) => setAsset({ ...asset, kind: v as "MUSIC" | "SFX" })}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="MUSIC">Music</SelectItem>
                <SelectItem value="SFX">Sound effect</SelectItem>
              </SelectContent>
            </Select>
            <Input className="sm:col-span-2" placeholder="Public URL of the audio file (e.g. Vercel Blob)" value={asset.url} onChange={(e) => setAsset({ ...asset, url: e.target.value })} />
            <Input placeholder="License (e.g. CC0, purchased license #)" value={asset.license} onChange={(e) => setAsset({ ...asset, license: e.target.value })} />
            <Input placeholder="Source (where it came from)" value={asset.source} onChange={(e) => setAsset({ ...asset, source: e.target.value })} />
            <Input className="sm:col-span-2" placeholder="Attribution (if required)" value={asset.attribution} onChange={(e) => setAsset({ ...asset, attribution: e.target.value })} />
          </div>
          <Button size="sm" disabled={a.pending} onClick={() => a.run(() => addAudioAsset(asset), { success: "Audio asset added" })}>
            {a.pending ? <Loader2 className="animate-spin" /> : <Plus />} Add asset
          </Button>
        </Card>
      </Section>

      <Section title="Defaults" description="Pre-filled on the Generate page and used by the pipeline.">
        <Card>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Illustration style</Label>
              <Select value={defaults.styleKey} onValueChange={(v) => setDefaults({ ...defaults, styleKey: v })}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(ILLUSTRATION_STYLES).map(([k, s]) => (
                    <SelectItem key={k} value={k}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Duration</Label>
              <Select value={String(defaults.durationSec)} onValueChange={(v) => setDefaults({ ...defaults, durationSec: Number(v) })}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TARGET_DURATIONS.map((d) => (
                    <SelectItem key={d} value={String(d)}>
                      {d} seconds
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Parts per story</Label>
              <Select value={String(defaults.partsPerStory)} onValueChange={(v) => setDefaults({ ...defaults, partsPerStory: Number(v) })}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[1, 2, 3, 4].map((n) => (
                    <SelectItem key={n} value={String(n)}>
                      {n === 1 ? "1 video (complete story)" : `${n} videos, planned together`}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Quality</Label>
              <Select value={defaults.quality} onValueChange={(v) => setDefaults({ ...defaults, quality: v as Defaults["quality"] })}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(QUALITY_PRESETS).map(([k, q]) => (
                    <SelectItem key={k} value={k}>
                      {q.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Default batch budget (USD)</Label>
              <Input type="number" min={1} value={defaults.maxBatchBudgetUsd} onChange={(e) => setDefaults({ ...defaults, maxBatchBudgetUsd: Number(e.target.value) })} />
            </div>
          </div>
          <div className="flex items-center justify-between gap-4">
            <div>
              <Label htmlFor="refs">Use style reference images</Label>
              <p className="text-xs text-muted-foreground">Pass earlier illustrations to the image model so line weight and figures stay consistent.</p>
            </div>
            <Switch id="refs" checked={defaults.useStyleReferences} onCheckedChange={(c) => setDefaults({ ...defaults, useStyleReferences: c })} />
          </div>
          <div className="flex items-center justify-between gap-4">
            <div>
              <Label htmlFor="review">Check and redraw images</Label>
              <p className="text-xs text-muted-foreground">
                A vision model checks each image against its line of the story (right place, right people, right time of day, no text) and redraws it once if it is wrong. About $0.002 per check plus the occasional redraw.
              </p>
            </div>
            <Switch id="review" checked={defaults.imageCheck} onCheckedChange={(c) => setDefaults({ ...defaults, imageCheck: c })} />
          </div>
          <Button size="sm" disabled={a.pending} onClick={() => a.run(() => saveDefaults(defaults), { success: "Defaults saved" })}>
            Save
          </Button>
        </Card>
      </Section>
    </div>
  );
}
