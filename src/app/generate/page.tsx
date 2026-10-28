import { Suspense } from "react";
import { connection } from "next/server";
import type { Metadata } from "next";
import { PageHeader, PageSkeleton } from "@/components/studio";
import { GenerateForm } from "./generate-form";
import { getDefaults, getPricing, getVoices, modelNames } from "@/lib/settings";

export const metadata: Metadata = { title: "Generate" };

export default function GeneratePage() {
  return (
    <>
      <PageHeader
        title="Generate opening episodes"
        description="Pitch, score and select new story concepts. Concept mode spends only on text; full production also illustrates, narrates and renders."
      />
      <Suspense fallback={<PageSkeleton />}>
        <GenerateContent />
      </Suspense>
    </>
  );
}

async function GenerateContent() {
  await connection();
  const [voices, defaults, pricing] = await Promise.all([getVoices(), getDefaults(), getPricing()]);
  return <GenerateForm voices={voices} defaults={defaults} pricing={pricing} models={modelNames()} />;
}
