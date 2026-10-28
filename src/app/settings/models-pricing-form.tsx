"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Section } from "@/components/studio";
import { useAction } from "@/components/client-helpers";
import { saveModelsAndPricing } from "@/app/actions";
import { DEFAULT_PRICING, textModelPrice, type Pricing } from "@/lib/costs/pricing";
import { estimateEpisodeCost, formatUsd } from "@/lib/costs/estimate";
import type { Models } from "@/lib/settings";

// Suggestions only; any model name the provider accepts can be typed in.
const SUGGESTIONS = {
  text: ["gpt-5.5", "gpt-5.4", "gpt-5.4-mini"],
  image: ["gpt-image-2"],
  speech: ["eleven_multilingual_v2", "eleven_v3", "eleven_turbo_v2_5", "eleven_flash_v2_5"],
};

type TextPrice = { inputPerMTok: string; cachedInputPerMTok: string; outputPerMTok: string };

const str = (n: number) => String(n);
const textPriceStrings = (pricing: Pricing, model: string): TextPrice => {
  const p = textModelPrice(pricing, model);
  return { inputPerMTok: str(p.inputPerMTok), cachedInputPerMTok: str(p.cachedInputPerMTok), outputPerMTok: str(p.outputPerMTok) };
};

function Money({ label, value, onChange, unit }: { label: string; value: string; onChange: (v: string) => void; unit: string }) {
  return (
    <label className="space-y-1">
      <span className="block text-xs text-muted-foreground">{label}</span>
      <div className="flex items-center gap-1.5">
        <span className="text-sm text-muted-foreground">$</span>
        <Input inputMode="decimal" value={value} onChange={(e) => onChange(e.target.value)} className="h-8 tabular-nums" aria-label={`${label} (${unit})`} />
      </div>
      <span className="block text-[11px] text-muted-foreground">{unit}</span>
    </label>
  );
}

function ModelRow({
  role,
  description,
  model,
  onModel,
  suggestions,
  children,
}: {
  role: string;
  description: string;
  model: string;
  /** Omitted for rows whose name is fixed. */
  onModel?: (v: string) => void;
  suggestions: string[];
  children: React.ReactNode;
}) {
  const listId = `models-${role.toLowerCase().replace(/\W+/g, "-")}`;
  return (
    <div className="grid gap-4 border-b py-5 first:pt-0 last:border-b-0 last:pb-0 lg:grid-cols-[minmax(0,17rem)_1fr]">
      <div className="space-y-2">
        <div>
          <Label htmlFor={listId + "-input"}>{role}</Label>
          <p className="text-xs text-muted-foreground">{description}</p>
        </div>
        <Input
          id={listId + "-input"}
          list={listId}
          value={model}
          onChange={(e) => onModel?.(e.target.value)}
          readOnly={!onModel}
          disabled={!onModel}
          className="font-mono text-xs"
          spellCheck={false}
        />
        <datalist id={listId}>
          {suggestions.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{children}</div>
    </div>
  );
}

export function ModelsPricingForm(props: { models: Models; pricing: Pricing; imageSize: string; renderProvider: string; vcpus: number }) {
  const [models, setModels] = useState(props.models);
  const [main, setMain] = useState(() => textPriceStrings(props.pricing, props.models.main));
  const [fast, setFast] = useState(() => textPriceStrings(props.pricing, props.models.fast));
  const [imageTokens, setImageTokens] = useState(() => ({
    textInputPerMTok: str(props.pricing.imageTokens.textInputPerMTok),
    imageInputPerMTok: str(props.pricing.imageTokens.imageInputPerMTok),
    outputPerMTok: str(props.pricing.imageTokens.outputPerMTok),
  }));
  const [perImage, setPerImage] = useState(() => ({
    low: str(props.pricing.imagePerImage.low),
    medium: str(props.pricing.imagePerImage.medium),
    high: str(props.pricing.imagePerImage.high),
  }));
  const [speech, setSpeech] = useState(str(props.pricing.elevenLabsPer1kChars));
  const [sandbox, setSandbox] = useState({ perVcpuHour: str(props.pricing.sandboxPerVcpuHour), overhead: str(props.pricing.sandboxOverheadPerRender) });
  const a = useAction();

  const num = (v: string) => Number(v);
  const toText = (p: TextPrice) => ({ inputPerMTok: num(p.inputPerMTok), cachedInputPerMTok: num(p.cachedInputPerMTok), outputPerMTok: num(p.outputPerMTok) });

  // Prices are keyed by model name; earlier entries are kept so switching back restores them.
  const pricing: Pricing = useMemo(
    () => ({
      textModels: { ...props.pricing.textModels, [models.fast.trim()]: toText(fast), [models.main.trim()]: toText(main), default: toText(main) },
      imageTokens: { textInputPerMTok: num(imageTokens.textInputPerMTok), imageInputPerMTok: num(imageTokens.imageInputPerMTok), outputPerMTok: num(imageTokens.outputPerMTok) },
      imagePerImage: { low: num(perImage.low), medium: num(perImage.medium), high: num(perImage.high) },
      elevenLabsPer1kChars: num(speech),
      sandboxPerVcpuHour: num(sandbox.perVcpuHour),
      sandboxOverheadPerRender: num(sandbox.overhead),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [models, main, fast, imageTokens, perImage, speech, sandbox, props.pricing.textModels],
  );
  const valid = Object.values({ ...toText(main), ...toText(fast), ...pricing.imageTokens, ...pricing.imagePerImage }).every((n) => Number.isFinite(n) && n >= 0) &&
    [pricing.elevenLabsPer1kChars, pricing.sandboxPerVcpuHour, pricing.sandboxOverheadPerRender].every((n) => Number.isFinite(n) && n >= 0);
  const sample = valid ? estimateEpisodeCost(pricing, models, { durationSec: 75, quality: "STANDARD" }) : null;

  // Picking a model with a saved price fills its prices in.
  const pickText = (role: "main" | "fast", name: string) => {
    setModels({ ...models, [role]: name });
    const known = props.pricing.textModels[name] ?? DEFAULT_PRICING.textModels[name];
    if (known) (role === "main" ? setMain : setFast)({ inputPerMTok: str(known.inputPerMTok), cachedInputPerMTok: str(known.cachedInputPerMTok), outputPerMTok: str(known.outputPerMTok) });
  };

  return (
    <Section
      title="Models & pricing"
      description="Which model does each job, and what it costs. Prices drive every estimate and budget check; changes apply to new jobs."
      actions={
        sample ? (
          <p className="text-sm text-muted-foreground">
            ≈ <span className="font-medium text-foreground tabular-nums">{formatUsd(sample.total)}</span> per 75s episode at Standard
          </p>
        ) : null
      }
    >
      <div className="rounded-xl border bg-card p-5">
        <ModelRow role="Writing" description="Concepts, hooks and scripts at Standard and Premium quality; reviews too at Premium." model={models.main} onModel={(v) => pickText("main", v)} suggestions={SUGGESTIONS.text}>
          <Money label="Input" unit="per 1M tokens" value={main.inputPerMTok} onChange={(v) => setMain({ ...main, inputPerMTok: v })} />
          <Money label="Cached input" unit="per 1M tokens" value={main.cachedInputPerMTok} onChange={(v) => setMain({ ...main, cachedInputPerMTok: v })} />
          <Money label="Output" unit="per 1M tokens" value={main.outputPerMTok} onChange={(v) => setMain({ ...main, outputPerMTok: v })} />
        </ModelRow>

        <ModelRow role="Reviewing" description="Concept scoring and continuity checks at Draft and Standard; all writing at Draft." model={models.fast} onModel={(v) => pickText("fast", v)} suggestions={SUGGESTIONS.text}>
          <Money label="Input" unit="per 1M tokens" value={fast.inputPerMTok} onChange={(v) => setFast({ ...fast, inputPerMTok: v })} />
          <Money label="Cached input" unit="per 1M tokens" value={fast.cachedInputPerMTok} onChange={(v) => setFast({ ...fast, cachedInputPerMTok: v })} />
          <Money label="Output" unit="per 1M tokens" value={fast.outputPerMTok} onChange={(v) => setFast({ ...fast, outputPerMTok: v })} />
        </ModelRow>

        <ModelRow role="Illustrations" description={`Scene images at ${props.imageSize}. Token prices are used when the API reports usage.`} model={models.image} onModel={(v) => setModels({ ...models, image: v })} suggestions={SUGGESTIONS.image}>
          <Money label="Text input" unit="per 1M tokens" value={imageTokens.textInputPerMTok} onChange={(v) => setImageTokens({ ...imageTokens, textInputPerMTok: v })} />
          <Money label="Image input" unit="per 1M tokens" value={imageTokens.imageInputPerMTok} onChange={(v) => setImageTokens({ ...imageTokens, imageInputPerMTok: v })} />
          <Money label="Image output" unit="per 1M tokens" value={imageTokens.outputPerMTok} onChange={(v) => setImageTokens({ ...imageTokens, outputPerMTok: v })} />
          <Money label="Draft image" unit="per image (low)" value={perImage.low} onChange={(v) => setPerImage({ ...perImage, low: v })} />
          <Money label="Standard image" unit="per image (medium)" value={perImage.medium} onChange={(v) => setPerImage({ ...perImage, medium: v })} />
          <Money label="Premium image" unit="per image (high)" value={perImage.high} onChange={(v) => setPerImage({ ...perImage, high: v })} />
        </ModelRow>

        <ModelRow role="Narration" description="ElevenLabs model. It must support character timestamps for captions." model={models.speech} onModel={(v) => setModels({ ...models, speech: v })} suggestions={SUGGESTIONS.speech}>
          <Money label="Speech" unit="per 1,000 characters" value={speech} onChange={setSpeech} />
        </ModelRow>

        <ModelRow
          role="Rendering"
          description={`Vercel Sandbox, ${props.vcpus} vCPUs (${props.renderProvider}). Not a model; listed for its cost.`}
          model="Remotion"
          suggestions={[]}
        >
          <Money label="Compute" unit="per vCPU-hour" value={sandbox.perVcpuHour} onChange={(v) => setSandbox({ ...sandbox, perVcpuHour: v })} />
          <Money label="Overhead" unit="per render (setup)" value={sandbox.overhead} onChange={(v) => setSandbox({ ...sandbox, overhead: v })} />
        </ModelRow>

        <div className="flex flex-wrap items-center gap-3 border-t pt-4">
          <Button size="sm" disabled={a.pending || !valid} onClick={() => a.run(() => saveModelsAndPricing(models, pricing), { success: "Models and pricing saved" })}>
            Save models & pricing
          </Button>
          {!valid ? <span className="text-xs text-destructive">Prices must be numbers of 0 or more.</span> : null}
          <span className="text-xs text-muted-foreground">Defaults are October 2026 list prices; check your plan for discounts.</span>
        </div>
      </div>
    </Section>
  );
}
