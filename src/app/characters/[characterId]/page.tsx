import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Clapperboard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState, Money, PageHeader, PageSkeleton, StoryStatusBadge, Thumb, relativeTime } from "@/components/studio";
import { ActionButton } from "@/components/client-helpers";
import { getCharacter } from "@/lib/queries";
import { getVoices } from "@/lib/settings";
import { setCharacterArchived } from "@/app/actions";
import { CharacterEditor, DrawSheetButton } from "../character-forms";

export const metadata: Metadata = { title: "Character" };
// Drawing the character sheet is one image generation, run inside the server action.
export const maxDuration = 300;

export default function CharacterPage(props: PageProps<"/characters/[characterId]">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <CharacterContent params={props.params} />
    </Suspense>
  );
}

async function CharacterContent({ params }: { params: PageProps<"/characters/[characterId]">["params"] }) {
  const { characterId } = await params;
  const [data, voices] = await Promise.all([getCharacter(characterId), getVoices()]);
  if (!data) notFound();
  const { character: c, spentUsd } = data;
  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/characters" className="hover:underline">
            Characters
          </Link>
        }
        title={c.name}
        description={c.tagline}
        actions={
          <>
            <ActionButton
              variant="ghost"
              size="sm"
              action={setCharacterArchived.bind(null, c.id, !c.archivedAt)}
              success={c.archivedAt ? "Restored" : "Archived"}
            >
              {c.archivedAt ? "Restore" : "Archive"}
            </ActionButton>
            <Button asChild>
              <Link href="/channels">
                <Clapperboard /> Channels
              </Link>
            </Button>
          </>
        }
      />

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          <div className="space-y-3 rounded-xl border bg-card p-4">
            <Thumb src={c.sheetUrl} alt={`${c.name} character sheet`} className="aspect-[3/2]" />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                {c.sheetUrl ? "Every scene is drawn from this sheet, so the character stays on-model." : "Draw the character before making videos so every scene matches."}
              </p>
              <DrawSheetButton characterId={c.id} hasSheet={Boolean(c.sheetUrl)} />
            </div>
          </div>

          <section className="space-y-3">
            <div className="flex items-end justify-between">
              <h2 className="text-base font-semibold tracking-tight">Series</h2>
              <span className="text-xs text-muted-foreground">
                Spent <Money value={spentUsd} />
              </span>
            </div>
            {c.stories.length === 0 ? (
              <EmptyState title={`No series with ${c.name} yet`} description="Make videos to pitch series ideas that star this character." />
            ) : (
              <ul className="divide-y rounded-xl border bg-card">
                {c.stories.map((s) => (
                  <li key={s.id}>
                    <Link href={`/stories/${s.id}`} className="flex items-center gap-3 p-3 hover:bg-muted/50">
                      <Thumb src={s.thumbnailUrl} alt="" className="aspect-[3/2] w-20 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{s.title}</p>
                        <p className="text-xs text-muted-foreground">
                          {s._count.episodes} ep · {relativeTime(s.lastActivityAt)}
                        </p>
                      </div>
                      <StoryStatusBadge status={s.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <CharacterEditor
          characterId={c.id}
          voices={voices}
          initial={{
            name: c.name,
            tagline: c.tagline,
            personality: c.personality,
            backstory: c.backstory,
            speakingStyle: c.speakingStyle,
            visualDescription: c.visualDescription,
            signatureColor: c.signatureColor,
            bandColor: c.bandColor,
            perspective: c.perspective,
            voiceId: c.voiceId,
          }}
        />
      </div>
    </>
  );
}
