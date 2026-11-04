import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import type { Metadata } from "next";
import { Factory } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState, PageHeader, PageSkeleton } from "@/components/studio";
import { listChannels } from "@/lib/queries";
import { ILLUSTRATION_STYLES } from "@/lib/constants";
import { CHANNEL_FORMATS } from "@/lib/schemas/channel";
import { getVoices } from "@/lib/settings";
import { CreateChannelForm } from "./channel-forms";

export const metadata: Metadata = { title: "Channels" };

export default function ChannelsPage() {
  return (
    <>
      <PageHeader title="Channels" description="Your TikTok channels. Each one sets the voice, art style and storyboard rules your pasted scripts are made with." />
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
        <Suspense fallback={<PageSkeleton />}>
          <ChannelList />
        </Suspense>
        <Suspense fallback={null}>
          <NewChannel />
        </Suspense>
      </div>
    </>
  );
}

async function NewChannel() {
  await connection();
  return <CreateChannelForm voices={await getVoices()} />;
}

async function ChannelList() {
  const channels = await listChannels();
  if (channels.length === 0) return <EmptyState title="No channels yet" description="Add one on the right." />;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {channels.map((c) => {
        return (
          <div key={c.id} className="flex flex-col overflow-hidden rounded-xl border bg-card">
            <div className="flex flex-1 flex-col gap-2 p-4">
              <div className="flex items-center gap-2">
                <Factory className="size-4 text-muted-foreground" />
                <Link href={`/channels/${c.id}`} className="font-medium hover:underline">
                  {c.name}
                </Link>
              </div>
              <div className="flex flex-wrap gap-1.5 text-xs">
                <Badge variant="outline">{CHANNEL_FORMATS[c.format].label}</Badge>
                <Badge variant="outline">{ILLUSTRATION_STYLES[c.styleKey as keyof typeof ILLUSTRATION_STYLES]?.label ?? c.styleKey}</Badge>
                <Badge variant="outline">
                  {c._count.stories} {c._count.stories === 1 ? "story" : "stories"}
                </Badge>
              </div>
              <div className="mt-auto flex gap-2 pt-2">
                <Button asChild size="sm">
                  <Link href={`/generate?channel=${c.id}`}>Make videos</Link>
                </Button>
                <Button asChild size="sm" variant="outline">
                  <Link href={`/channels/${c.id}`}>Edit</Link>
                </Button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
