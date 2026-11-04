import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import type { Metadata } from "next";
import { Factory } from "lucide-react";
import { EmptyState, PageHeader, PageSkeleton } from "@/components/studio";
import { Button } from "@/components/ui/button";
import { listChannels } from "@/lib/queries";
import { CHANNEL_FORMATS } from "@/lib/schemas/channel";
import { getAudioMix, getModels, getPricing, voiceWordsPerSecond } from "@/lib/settings";
import { DEFAULT_WORDS_PER_SECOND } from "@/lib/text";
import { cn } from "@/lib/utils";
import { GenerateForm } from "./generate-form";

export const metadata: Metadata = { title: "Make videos" };

export default function GeneratePage(props: PageProps<"/generate">) {
  return (
    <>
      <PageHeader
        title="Make videos"
        description="Paste your script and choose how many videos to split it into. The pictures, voiceover and edit are made for you; your words are spoken exactly as written."
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
  const channels = await listChannels();
  if (channels.length === 0) {
    return (
      <EmptyState
        title="No channels yet"
        description="Set up a channel first: it picks the voice and art style."
        action={
          <Button asChild>
            <Link href="/channels">Channels</Link>
          </Button>
        }
      />
    );
  }
  const selected = channels.find((c) => c.id === sp.channel) ?? channels[0];
  const [pricing, models, mix] = await Promise.all([getPricing(), getModels(), getAudioMix()]);
  const measured = selected.voiceId ? await voiceWordsPerSecond(selected.voiceId, mix.maxPauseMs) : null;
  return (
    <div className="space-y-8">
      {channels.length > 1 ? (
        <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Channel">
          {channels.map((c) => {
            const active = c.id === selected.id;
            return (
              <Link
                key={c.id}
                href={`/generate?channel=${c.id}`}
                role="radio"
                aria-checked={active}
                className={cn("rounded-xl border bg-card p-4 transition-colors", active ? "border-primary ring-2 ring-primary/15" : "hover:border-foreground/20")}
              >
                <div className="flex items-center gap-2 font-medium">
                  <Factory className="size-4" /> {c.name}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{CHANNEL_FORMATS[c.format].label}</p>
              </Link>
            );
          })}
        </div>
      ) : null}
      <GenerateForm
        key={selected.id}
        channel={{
          id: selected.id,
          name: selected.name,
          quality: selected.quality,
          wordsPerSecond: (measured ?? DEFAULT_WORDS_PER_SECOND) * mix.narrationSpeed,
          measured: measured !== null,
        }}
        pricing={pricing}
        models={{ main: models.main, fast: models.fast }}
      />
    </div>
  );
}
