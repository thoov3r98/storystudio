import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import type { Metadata } from "next";
import { Factory } from "lucide-react";
import { EmptyState, PageHeader, PageSkeleton } from "@/components/studio";
import { Button } from "@/components/ui/button";
import { listChannels } from "@/lib/queries";
import { parseProfile } from "@/lib/schemas/channel";
import { cn } from "@/lib/utils";
import { GenerateForm } from "./generate-form";

export const metadata: Metadata = { title: "Generate" };

export default function GeneratePage(props: PageProps<"/generate">) {
  return (
    <>
      <PageHeader
        title="Make videos"
        description="Pick a channel, then give it an idea or let it surprise you. You choose one of three pitches; its scripts are written and wait for your review before anything else is spent."
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
        description="Set up a channel first."
        action={
          <Button asChild>
            <Link href="/channels">Channels</Link>
          </Button>
        }
      />
    );
  }
  const selected = channels.find((c) => c.id === sp.channel) ?? channels[0];
  const profile = parseProfile(selected.profile);
  return (
    <div className="space-y-8">
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
              <p className="mt-1 text-sm text-muted-foreground">{parseProfile(c.profile).summary}</p>
            </Link>
          );
        })}
      </div>
      <GenerateForm
        key={selected.id}
        channel={{ id: selected.id, name: selected.name, examples: profile.examples, minParts: selected.minParts, maxParts: selected.maxParts }}
      />
    </div>
  );
}
