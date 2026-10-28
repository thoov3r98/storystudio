import { Suspense } from "react";
import { connection } from "next/server";
import type { Metadata } from "next";
import { PageHeader, PageSkeleton } from "@/components/studio";
import { SetupChecklist } from "@/components/setup-checklist";
import { db } from "@/lib/db";
import { getAudioMix, getDefaults, getPricing, getVoiceSettings, getVoices, modelNames } from "@/lib/settings";
import { env } from "@/lib/env";
import { SettingsForms } from "./settings-forms";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings" description="Narrators, audio, defaults and the provider pricing used for every cost estimate." />
      <Suspense fallback={<PageSkeleton />}>
        <SettingsContent />
      </Suspense>
    </>
  );
}

async function SettingsContent() {
  await connection();
  const [voices, voiceSettings, audioMix, defaults, pricing, audioAssets] = await Promise.all([
    getVoices(),
    getVoiceSettings(),
    getAudioMix(),
    getDefaults(),
    getPricing(),
    db.audioAsset.findMany({ orderBy: { createdAt: "desc" } }),
  ]);
  const e = env();
  return (
    <div className="space-y-10">
      <SetupChecklist />
      <div className="rounded-xl border bg-card p-4 text-sm text-muted-foreground">
        Models: writing <code>{modelNames().main}</code>, reviewing <code>{modelNames().fast}</code>, images <code>{e.OPENAI_IMAGE_MODEL}</code> at{" "}
        <code>{e.OPENAI_IMAGE_SIZE}</code>, narration <code>{e.ELEVENLABS_MODEL_ID}</code>. Rendering: <code>{e.RENDER_PROVIDER}</code>. Change these with environment variables.
      </div>
      <SettingsForms
        voices={voices}
        voiceSettings={voiceSettings}
        audioMix={audioMix}
        defaults={defaults}
        pricingJson={JSON.stringify(pricing, null, 2)}
        audioAssets={audioAssets.map((a) => ({ id: a.id, name: a.name, kind: a.kind, license: a.license, source: a.source, attribution: a.attribution, url: a.url }))}
      />
    </div>
  );
}
