import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Clapperboard } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader, PageSkeleton, StoryStatusBadge, Thumb, relativeTime } from "@/components/studio";
import { ActionButton } from "@/components/client-helpers";
import { getChannel, listCharacters } from "@/lib/queries";
import { getVoices } from "@/lib/settings";
import { CHANNEL_FORMATS, parseProfile } from "@/lib/schemas/channel";
import { setChannelArchived } from "@/app/actions";
import { ChannelEditor } from "../channel-forms";

export const metadata: Metadata = { title: "Channel" };

export default function ChannelPage(props: PageProps<"/channels/[channelId]">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ChannelContent params={props.params} />
    </Suspense>
  );
}

async function ChannelContent({ params }: { params: PageProps<"/channels/[channelId]">["params"] }) {
  const { channelId } = await params;
  const [c, voices, characters] = await Promise.all([getChannel(channelId), getVoices(), listCharacters()]);
  if (!c) notFound();
  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/channels" className="hover:underline">
            Channels · {CHANNEL_FORMATS[c.format].label}
          </Link>
        }
        title={c.name}
        description={c.brief}
        actions={
          <>
            <ActionButton variant="ghost" size="sm" action={setChannelArchived.bind(null, c.id, !c.archivedAt)} success={c.archivedAt ? "Restored" : "Archived"}>
              {c.archivedAt ? "Restore" : "Archive"}
            </ActionButton>
            {c.archivedAt ? null : (
              <Button asChild>
                <Link href={`/generate?channel=${c.id}`}>
                  <Clapperboard /> Make videos
                </Link>
              </Button>
            )}
          </>
        }
      />
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <ChannelEditor
          channelId={c.id}
          format={c.format}
          voices={voices}
          characters={characters.map((ch) => ({ id: ch.id, name: ch.name }))}
          initial={{
            name: c.name,
            characterId: c.characterId,
            perspective: c.perspective,
            voiceId: c.voiceId,
            styleKey: c.styleKey,
            targetDurationSec: c.targetDurationSec,
            minParts: c.minParts,
            maxParts: c.maxParts,
            quality: c.quality,
            profile: parseProfile(c.profile),
          }}
        />
        <section className="space-y-3">
          <h2 className="text-base font-semibold tracking-tight">Stories</h2>
          {c.stories.length === 0 ? (
            <EmptyState title="No stories yet" description="Make videos to pitch ideas for this channel." />
          ) : (
            <ul className="divide-y rounded-xl border bg-card">
              {c.stories.map((s) => (
                <li key={s.id}>
                  <Link href={`/stories/${s.id}`} className="flex items-center gap-3 p-3 hover:bg-muted/50">
                    <Thumb src={s.thumbnailUrl} alt="" className="aspect-[3/2] w-16 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{s.title}</p>
                      <p className="text-xs text-muted-foreground">
                        {s._count.episodes} part{s._count.episodes === 1 ? "" : "s"} · {relativeTime(s.lastActivityAt)}
                      </p>
                    </div>
                    <StoryStatusBadge status={s.status} />
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {c.batches.length ? (
            <>
              <h2 className="pt-4 text-base font-semibold tracking-tight">Recent pitches</h2>
              <ul className="divide-y rounded-xl border bg-card text-sm">
                {c.batches.map((b) => (
                  <li key={b.id}>
                    <Link href={`/batches/${b.id}`} className="block p-3 hover:bg-muted/50">
                      <span className="line-clamp-1">{b.customDirection ? `“${b.customDirection}”` : "Surprise me"}</span>
                      <span className="text-xs text-muted-foreground">{relativeTime(b.createdAt)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </section>
      </div>
    </>
  );
}
