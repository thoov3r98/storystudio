"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { AlertTriangle, Clapperboard, Lightbulb, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CATEGORIES, ILLUSTRATION_STYLES, MAX_BATCH_SIZE, QUALITY_PRESETS, TARGET_DURATIONS, CANDIDATE_MULTIPLIER } from "@/lib/constants";
import { estimateBatchCost, formatUsd, type ModelNames } from "@/lib/costs/estimate";
import type { Pricing } from "@/lib/costs/pricing";
import type { Defaults, Voice } from "@/lib/settings";
import { createBatch } from "@/app/actions";
import { cn } from "@/lib/utils";

type Mode = "CONCEPT" | "FULL_PRODUCTION";
type QualityKey = keyof typeof QUALITY_PRESETS;

function Field({ label, hint, children, htmlFor }: { label: string; hint?: string; children: React.ReactNode; htmlFor?: string }) {
  return (
    <div className="space-y-2">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export type StarringCharacter = { id: string; name: string; tagline: string; sheetUrl: string | null; signatureColor: string; voiceId: string | null };

export function GenerateForm({
  voices,
  defaults,
  pricing,
  models,
  character,
}: {
  voices: Voice[];
  defaults: Defaults;
  pricing: Pricing;
  models: ModelNames;
  character?: StarringCharacter | null;
}) {
  const [mode, setMode] = useState<Mode>("CONCEPT");
  // Character series default to everyday survival situations, the format they're built for.
  const [category, setCategory] = useState<string>(character ? "survival-scenarios" : "custom");
  const [direction, setDirection] = useState("");
  const selectedCategory = CATEGORIES.find((c) => c.value === category) ?? CATEGORIES[0];
  const [count, setCount] = useState(10);
  const [durationSec, setDuration] = useState<number>(defaults.durationSec);
  const [styleKey, setStyle] = useState(defaults.styleKey);
  const [voiceId, setVoice] = useState((character?.voiceId && voices.some((v) => v.id === character.voiceId) ? character.voiceId : voices[0]?.id) ?? "");
  const [quality, setQuality] = useState<QualityKey>(defaults.quality);
  const [budget, setBudget] = useState(String(defaults.maxBatchBudgetUsd));
  const [autoSelect, setAutoSelect] = useState(false);
  const [pending, start] = useTransition();

  const estimate = useMemo(
    () => estimateBatchCost(pricing, models, { requested: count, durationSec, quality, fullProduction: mode === "FULL_PRODUCTION" }),
    [pricing, models, count, durationSec, quality, mode],
  );
  const budgetNum = Number(budget);
  const affordableEpisodes = Math.max(0, Math.floor((budgetNum - estimate.ideation.total) / Math.max(estimate.perEpisode.total, 0.0001)));
  const overBudget = Number.isFinite(budgetNum) && estimate.total > budgetNum;

  const submit = () =>
    start(async () => {
      const result = await createBatch({
        mode,
        category,
        customDirection: direction,
        count,
        durationSec,
        styleKey,
        voiceId,
        quality,
        maxBudgetUsd: budgetNum,
        autoSelect: mode === "FULL_PRODUCTION" && autoSelect,
        characterId: character?.id ?? null,
      });
      // Success redirects to the batch page; only failures return here.
      if (result && !result.ok) toast.error(result.error);
    });

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="space-y-8">
        {character ? (
          <div className="flex items-center gap-4 rounded-xl border bg-card p-3" style={{ borderLeft: `6px solid ${character.signatureColor}` }}>
            {character.sheetUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={character.sheetUrl} alt="" className="aspect-[3/2] w-24 shrink-0 rounded-md border object-cover" />
            ) : null}
            <div className="min-w-0 flex-1">
              <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Starring</p>
              <p className="font-medium">{character.name}</p>
              <p className="truncate text-sm text-muted-foreground">{character.tagline}</p>
              {!character.sheetUrl ? (
                <p className="mt-1 text-xs text-warning">Not drawn yet: scenes won’t have a reference sheet to stay on-model.</p>
              ) : null}
            </div>
            <Button asChild variant="ghost" size="sm">
              <Link href="/generate">Remove</Link>
            </Button>
          </div>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Generation mode">
          {(
            [
              { value: "CONCEPT", title: "Concept mode", icon: Lightbulb, body: "Generate, evaluate and save concepts with hooks. No images, narration or rendering." },
              { value: "FULL_PRODUCTION", title: "Full production", icon: Clapperboard, body: "Concepts first, then produce MP4s for the ones you approve — or select automatically." },
            ] as const
          ).map((m) => (
            <button
              key={m.value}
              type="button"
              role="radio"
              aria-checked={mode === m.value}
              onClick={() => setMode(m.value)}
              className={cn(
                "rounded-xl border bg-card p-4 text-left transition-colors",
                mode === m.value ? "border-primary ring-2 ring-primary/15" : "hover:border-foreground/20",
              )}
            >
              <div className="flex items-center gap-2 font-medium">
                <m.icon className="size-4" /> {m.title}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{m.body}</p>
            </button>
          ))}
        </div>

        <div className="grid gap-6 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Topic</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger className="w-full">
                <SelectValue>{selectedCategory.label}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => (
                  <SelectItem key={c.value} value={c.value} className="py-2">
                    <span className="flex flex-col items-start gap-0.5">
                      <span>{c.label}</span>
                      <span className="max-w-72 text-xs whitespace-normal text-muted-foreground">{c.description}</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs">
              <p className="text-foreground">{selectedCategory.description}</p>
              <p className="mt-1 text-muted-foreground">Example: “{selectedCategory.example}”</p>
            </div>
          </div>

          <Field label={`Opening episodes: ${count}`} hint={`You get ${count} ${count === 1 ? "story" : "stories"}. Behind the scenes ${count * CANDIDATE_MULTIPLIER} ideas are pitched and the best ${count} kept.`}>
            <div className="flex items-center gap-3 pt-1">
              <Slider value={[count]} min={1} max={MAX_BATCH_SIZE} step={1} onValueChange={(v) => setCount(v[0])} className="flex-1" aria-label="Number of episodes" />
              <Input
                type="number"
                min={1}
                max={MAX_BATCH_SIZE}
                value={count}
                onChange={(e) => setCount(Math.max(1, Math.min(MAX_BATCH_SIZE, Number(e.target.value) || 1)))}
                className="w-20"
                aria-label="Number of episodes"
              />
            </div>
          </Field>

          <div className="sm:col-span-2">
            <Field
              label={category === "custom" ? "What should these videos be about?" : "Extra creative direction"}
              htmlFor="direction"
              hint={category === "custom" ? "Required. Describe the subject, genre, tone or angle; concepts are pitched from this." : "Optional. Themes, settings, or angles you want explored."}
            >
              <Textarea
                id="direction"
                value={direction}
                onChange={(e) => setDirection(e.target.value)}
                placeholder={
                  category === "custom"
                    ? "e.g. Strange true stories from ancient Rome, told as tense mini-mysteries"
                    : "e.g. Things that happen at night in airports that passengers never see"
                }
                rows={3}
              />
            </Field>
          </div>

          <Field label="Target duration">
            <div className="grid grid-cols-3 gap-2">
              {TARGET_DURATIONS.map((d) => (
                <Button key={d} type="button" variant={durationSec === d ? "default" : "outline"} onClick={() => setDuration(d)}>
                  {d}s
                </Button>
              ))}
            </div>
          </Field>

          <Field label="Generation quality" hint={QUALITY_PRESETS[quality].description}>
            <Select value={quality} onValueChange={(v) => setQuality(v as QualityKey)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(QUALITY_PRESETS) as QualityKey[]).map((q) => (
                  <SelectItem key={q} value={q}>
                    {QUALITY_PRESETS[q].label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Illustration style" hint={ILLUSTRATION_STYLES[styleKey as keyof typeof ILLUSTRATION_STYLES]?.description}>
            <Select value={styleKey} onValueChange={setStyle}>
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

          <Field label="Narrator voice">
            {voices.length ? (
              <Select value={voiceId} onValueChange={setVoice}>
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
            ) : (
              <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
                No voices configured. Add one in{" "}
                <Link href="/settings" className="underline">
                  Settings
                </Link>
                .
              </p>
            )}
          </Field>

          <Field label="Maximum batch budget (USD)" htmlFor="budget" hint="Hard stop: paid steps are skipped once this batch's recorded spend would exceed it.">
            <Input id="budget" type="number" min={1} step={1} value={budget} onChange={(e) => setBudget(e.target.value)} />
          </Field>

          {mode === "FULL_PRODUCTION" ? (
            <div className="flex items-start justify-between gap-4 rounded-xl border bg-card p-4 sm:col-span-2">
              <div>
                <Label htmlFor="auto">Automatically produce the top-ranked concepts</Label>
                <p className="mt-1 text-xs text-muted-foreground">
                  Off: you review ranked concepts and approve which to produce. On: production starts for the top {count} as soon as concepts are scored,
                  within the budget.
                </p>
              </div>
              <Switch id="auto" checked={autoSelect} onCheckedChange={setAutoSelect} />
            </div>
          ) : null}
        </div>
      </div>

      <aside className="h-fit space-y-4 rounded-xl border bg-card p-5 lg:sticky lg:top-8">
        <div>
          <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Estimated cost</div>
          <div className="mt-1 text-3xl font-semibold tabular-nums">≈ {formatUsd(estimate.total)}</div>
          <p className="mt-1 text-xs text-muted-foreground">Based on configured provider pricing. Not a guarantee — actual usage is recorded per job.</p>
        </div>
        <dl className="space-y-1.5 border-t pt-4 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Concepts + scoring + hooks</dt>
            <dd className="tabular-nums">{formatUsd(estimate.ideation.total)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Per produced episode</dt>
            <dd className="tabular-nums">{formatUsd(estimate.perEpisode.total)}</dd>
          </div>
          <div className="flex justify-between pl-3 text-xs text-muted-foreground">
            <dt>script & reviews · images · voice · render</dt>
            <dd className="tabular-nums">
              {formatUsd(estimate.perEpisode.text)} · {formatUsd(estimate.perEpisode.images)} · {formatUsd(estimate.perEpisode.speech)} · {formatUsd(estimate.perEpisode.render)}
            </dd>
          </div>
          {mode === "FULL_PRODUCTION" ? (
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Episodes the budget covers</dt>
              <dd className="tabular-nums">{Math.min(count, affordableEpisodes)} of {count}</dd>
            </div>
          ) : null}
        </dl>
        {overBudget ? (
          <div className="flex gap-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-900">
            <AlertTriangle className="size-4 shrink-0" />
            {mode === "FULL_PRODUCTION"
              ? `The full estimate exceeds your budget. Production will stop at the limit (about ${affordableEpisodes} episode${affordableEpisodes === 1 ? "" : "s"}).`
              : "The estimate exceeds your budget."}
          </div>
        ) : null}
        <Button
          className="w-full"
          size="lg"
          onClick={submit}
          disabled={pending || !voiceId || !(budgetNum > 0) || (category === "custom" && !direction.trim())}
        >
          {pending ? <Loader2 className="animate-spin" /> : null}
          {mode === "CONCEPT" ? `Generate ${count} concept${count === 1 ? "" : "s"}` : `Start production batch`}
        </Button>
      </aside>
    </div>
  );
}
