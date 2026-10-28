import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { EmptyState, PageHeader, PageSkeleton, Thumb } from "@/components/studio";
import { listCharacters } from "@/lib/queries";
import { CreateCharacterForm } from "./character-forms";

export const metadata: Metadata = { title: "Characters" };
// Designing a character is one model call, run inside the server action.
export const maxDuration = 120;

export default function CharactersPage() {
  return (
    <>
      <PageHeader
        title="Characters"
        description="Recurring narrator-heroes to build series around. Design one, draw them, then make videos starring them."
      />
      <div className="grid gap-8 lg:grid-cols-[minmax(0,22rem)_1fr]">
        <CreateCharacterForm />
        <Suspense fallback={<PageSkeleton />}>
          <CharacterGrid />
        </Suspense>
      </div>
    </>
  );
}

async function CharacterGrid() {
  const characters = await listCharacters();
  if (characters.length === 0) {
    return <EmptyState title="No characters yet" description="Describe one on the left. They’ll narrate their own series in their own voice." />;
  }
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {characters.map((c) => (
        <Link key={c.id} href={`/characters/${c.id}`} className="group overflow-hidden rounded-xl border bg-card transition-colors hover:border-foreground/30">
          <Thumb src={c.sheetUrl} alt={`${c.name} character sheet`} className="aspect-[3/2] rounded-none border-0 border-b" />
          <div className="space-y-1 p-4">
            <div className="flex items-center gap-2">
              <span className="size-3 shrink-0 rounded-full border" style={{ backgroundColor: c.signatureColor }} aria-hidden />
              <h3 className="font-medium group-hover:underline">{c.name}</h3>
            </div>
            <p className="line-clamp-2 text-sm text-muted-foreground">{c.tagline}</p>
            <p className="text-xs text-muted-foreground">
              {c._count.stories} {c._count.stories === 1 ? "series" : "series"}
              {c.sheetUrl ? "" : " · not drawn yet"}
            </p>
          </div>
        </Link>
      ))}
    </div>
  );
}
