import { Suspense } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState, PageHeader, PageSkeleton, StoryStatusBadge, Thumb, relativeTime } from "@/components/studio";
import { listChannels, listStories, STORY_FILTERS } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { LibrarySelection, SelectableStory } from "./library-selection";

export const metadata: Metadata = { title: "Story Library" };

export default function StoriesPage(props: PageProps<"/stories">) {
  return (
    <>
      <PageHeader
        title="Story Library"
        description="Every storyline is kept indefinitely. Open one to continue it with Part 2, 3, 4 and beyond."
        actions={
          <Button asChild>
            <Link href="/generate">Make videos</Link>
          </Button>
        }
      />
      <Suspense fallback={<PageSkeleton />}>
        <StoriesContent searchParams={props.searchParams} />
      </Suspense>
    </>
  );
}

function href(params: Record<string, string | undefined>) {
  const sp = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => Boolean(e[1]) && e[1] !== "all"));
  const s = sp.toString();
  return s ? `/stories?${s}` : "/stories";
}

async function StoriesContent({ searchParams }: { searchParams: PageProps<"/stories">["searchParams"] }) {
  const sp = await searchParams;
  const filter = typeof sp.filter === "string" ? sp.filter : "all";
  const q = typeof sp.q === "string" ? sp.q : "";
  const channel = typeof sp.channel === "string" ? sp.channel : "all";
  const [stories, channels] = await Promise.all([listStories({ filter, q, channel }), listChannels()]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <nav className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1" aria-label="Story status filter">
          {STORY_FILTERS.map((f) => (
            <Link
              key={f.value}
              href={href({ filter: f.value, q, channel })}
              className={cn(
                "shrink-0 rounded-full border px-3 py-1 text-sm transition-colors",
                filter === f.value ? "border-primary bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:text-foreground",
              )}
            >
              {f.label}
            </Link>
          ))}
        </nav>
        <form action="/stories" className="flex gap-2">
          {filter !== "all" ? <input type="hidden" name="filter" value={filter} /> : null}
          <select
            name="channel"
            defaultValue={channel}
            className="h-8 rounded-lg border border-input bg-background px-2 text-sm"
            aria-label="Channel"
          >
            <option value="all">All channels</option>
            {channels.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
            <option value="none">Before channels</option>
          </select>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input name="q" defaultValue={q} placeholder="Search title, premise, keyword" className="w-64 max-w-full pl-8" />
          </div>
          <Button type="submit" variant="outline">
            Search
          </Button>
        </form>
      </div>

      {stories.length === 0 ? (
        <EmptyState
          title={q || filter !== "all" || channel !== "all" ? "No stories match" : "Your library is empty"}
          description={q ? "Try a different search or filter." : "Make videos for a channel to start your first story."}
        />
      ) : (
        <LibrarySelection ids={stories.map((s) => s.id)} archivedView={filter === "archived"}>
        <div className="grid gap-4 pb-20 sm:grid-cols-2 xl:grid-cols-3">
          {stories.map((s) => (
            <SelectableStory key={s.id} id={s.id} title={s.title}>
            <Link href={`/stories/${s.id}`} className="group flex h-full gap-4 rounded-xl border bg-card p-4 pr-10 transition-colors hover:border-foreground/20">
              <Thumb src={s.thumbnailUrl} alt="" className="aspect-[9/16] w-20 shrink-0 self-start" />
              <div className="flex min-w-0 flex-1 flex-col">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="line-clamp-2 font-medium text-balance group-hover:underline">{s.title}</h3>
                </div>
                <p className="mt-1 line-clamp-3 text-sm text-muted-foreground">{s.premise}</p>
                <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1.5 pt-3 text-xs text-muted-foreground">
                  <StoryStatusBadge status={s.status} />
                  <span>{s.channel?.name ?? "Before channels"}</span>
                  <span>
                    {s._count.episodes} episode{s._count.episodes === 1 ? "" : "s"}
                  </span>
                </div>
                <div className="mt-1.5 text-[11px] text-muted-foreground">
                  Created {s.createdAt.toLocaleDateString()} · active {relativeTime(s.lastActivityAt)}
                </div>
              </div>
            </Link>
            </SelectableStory>
          ))}
        </div>
        </LibrarySelection>
      )}
    </div>
  );
}
