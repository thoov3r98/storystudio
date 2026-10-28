import { Suspense } from "react";
import { connection } from "next/server";
import type { Metadata } from "next";
import { PageHeader, PageSkeleton } from "@/components/studio";
import { SetupChecklist } from "@/components/setup-checklist";
import { db } from "@/lib/db";
import { getAudioMix, getDefaults, getModels, getPricing, getVoiceSettings, getVoices } from "@/lib/settings";
import { env } from "@/lib/env";
import { SettingsForms } from "./settings-forms";
import { ModelsPricingForm } from "./models-pricing-form";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings" description="Models and their prices, narrators, audio and production defaults." />
      <Suspense fallback={<PageSkeleton />}>
        <SettingsContent />
      </Suspense>
    </>
  );
}

async function SettingsContent() {
  await connection();
  const [voices, voiceSettings, audioMix, defaults, pricing, models, audioAssets] = await Promise.all([
    getVoices(),
    getVoiceSettings(),
    getAudioMix(),
    getDefaults(),
    getPricing(),
    getModels(),
    db.audioAsset.findMany({ orderBy: { createdAt: "desc" } }),
  ]);
  const e = env();
  return (
    <div className="space-y-10">
      <SetupChecklist />
      <ModelsPricingForm models={models} pricing={pricing} imageSize={e.OPENAI_IMAGE_SIZE} renderProvider={e.RENDER_PROVIDER} vcpus={e.RENDER_SANDBOX_VCPUS} />
      <SettingsForms
        voices={voices}
        voiceSettings={voiceSettings}
        audioMix={audioMix}
        defaults={defaults}
        audioAssets={audioAssets.map((a) => ({ id: a.id, name: a.name, kind: a.kind, license: a.license, source: a.source, attribution: a.attribution, url: a.url }))}
      />
    </div>
  );
}
