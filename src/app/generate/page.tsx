import { Suspense } from "react";
import { connection } from "next/server";
import type { Metadata } from "next";
import { PageHeader, PageSkeleton } from "@/components/studio";
import { GenerateForm } from "./generate-form";
import { getDefaults, getPricing, getVoices, getModels } from "@/lib/settings";
import { db } from "@/lib/db";

export const metadata: Metadata = { title: "Generate" };

export default function GeneratePage(props: PageProps<"/generate">) {
  return (
    <>
      <PageHeader
        title="Generate opening episodes"
        description="Pitch, score and select new story concepts. Concept mode spends only on text; full production also illustrates, narrates and renders."
      />
      <Suspense fallback={<PageSkeleton />}>
        <GenerateContent searchParams={props.searchParams} />
      </Suspense>
    </>
  );
}

async function GenerateContent({ searchParams }: { searchParams: PageProps<"/generate">["searchParams"] }) {
  await connection();
  const sp = await searchParams;
  const characterId = typeof sp.character === "string" ? sp.character : null;
  const [voices, defaults, pricing, models, character] = await Promise.all([
    getVoices(),
    getDefaults(),
    getPricing(),
    getModels(),
    characterId ? db.character.findFirst({ where: { id: characterId, archivedAt: null } }) : null,
  ]);
  return (
    <GenerateForm
      voices={voices}
      defaults={defaults}
      pricing={pricing}
      models={models}
      character={
        character
          ? { id: character.id, name: character.name, tagline: character.tagline, sheetUrl: character.sheetUrl, signatureColor: character.signatureColor, voiceId: character.voiceId }
          : null
      }
    />
  );
}
