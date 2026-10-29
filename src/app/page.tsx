import { Suspense } from "react";
import Link from "next/link";
import { AlertTriangle, BookOpen, CircleDollarSign, Clapperboard, Film, Loader, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState, Money, PageHeader, PageSkeleton, Section, StatCard, StoryStatusBadge, Thumb, relativeTime } from "@/components/studio";
import { AutoRefresh } from "@/components/client-helpers";
import { SetupChecklist } from "@/components/setup-checklist";
import { getDashboard } from "@/lib/queries";
import { previewUrl } from "@/lib/urls";

export default function DashboardPage() {
  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Scripts waiting for you, and everything currently in production."
        actions={
          <Button asChild size="lg">
            <Link href="/generate">
              <Sparkles /> Make videos
            </Link>
          </Button>
        }
      />
      <Suspense fallback={<PageSkeleton />}>
        <DashboardContent />
      </Suspense>
    </>
  );
}

async function DashboardContent() {
  const { stats, recentStories, recentRenders, scriptsToReview } = await getDashboard();
  return (
    <div className="space-y-10">
      <AutoRefresh active={stats.activeJobs > 0} intervalMs={8000} />
      <SetupChecklist />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Stories" value={stats.stories} icon={BookOpen} />
        <StatCard label="Opening episodes" value={stats.openingEpisodes} icon={Clapperboard} />
        <StatCard label="Completed MP4s" value={stats.completedVideos} icon={Film} tone="success" />
        <StatCard label="Active jobs" value={stats.activeJobs} icon={Loader} />
        <StatCard label="Failed jobs" value={stats.failedJobs} icon={AlertTriangle} tone={stats.failedJobs ? "danger" : "default"} />
        <StatCard label="Spend (est.)" value={<Money value={stats.spendUsd} />} icon={CircleDollarSign} hint="From configured pricing" />
      </div>

      {scriptsToReview.length ? (
        <Section title={`Scripts to review (${scriptsToReview.length})`} description="Each one is written and waiting. Nothing is spent on images, narration or rendering until you approve it.">
          <ul className="divide-y rounded-xl border bg-card">
            {scriptsToReview.map((e) => (
              <li key={e.id}>
                <Link href={`/episodes/${e.id}`} className="flex flex-col gap-1 p-4 hover:bg-muted/50 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{e.story.title}</div>
                    <p className="line-clamp-2 text-sm text-muted-foreground">
                      Part {e.partNumber} · {e.currentVersion?.summary}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">{relativeTime(e.updatedAt)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section
        title="Recent stories"
        actions={
          <Button asChild variant="ghost" size="sm">
            <Link href="/stories">View library</Link>
          </Button>
        }
      >
        {recentStories.length === 0 ? (
          <EmptyState
            title="No stories yet"
            description="Pitch ideas for a channel to start your library. Pitching costs a few cents."
            action={
              <Button asChild>
                <Link href="/generate">Make videos</Link>
              </Button>
            }
          />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {recentStories.map((s) => (
              <Link key={s.id} href={`/stories/${s.id}`} className="group flex gap-3 rounded-xl border bg-card p-3 transition-colors hover:border-foreground/20">
                <Thumb src={s.thumbnailUrl} alt="" className="h-24 w-16 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="line-clamp-2 text-sm font-medium group-hover:underline">{s.title}</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {s.channel?.name ?? "Before channels"} · {s._count.episodes} ep · {relativeTime(s.lastActivityAt)}
                  </div>
                  <div className="mt-2">
                    <StoryStatusBadge status={s.status} />
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </Section>

      <Section title="Recently completed videos">
        {recentRenders.length === 0 ? (
          <p className="text-sm text-muted-foreground">Finished MP4s will appear here.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {recentRenders.map((r) => {
              const ep = r.episodeVersion.episode;
              return (
                <Link key={r.id} href={`/episodes/${ep.id}`} className="group space-y-2">
                  <video src={r.url ? previewUrl(r.url) : undefined} className="aspect-[9/16] w-full rounded-lg border bg-black object-cover" preload="metadata" muted playsInline />
                  <div className="line-clamp-2 text-xs font-medium group-hover:underline">
                    {ep.story.title} · Part {ep.partNumber}
                  </div>
                </Link>
              );
            })}
          </div>
        )}
      </Section>
    </div>
  );
}
