import { Suspense } from "react";
import Link from "next/link";
import { AlertTriangle, BookOpen, CircleDollarSign, Clapperboard, Film, Loader, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState, Money, PageHeader, PageSkeleton, Section, StatCard, StoryStatusBadge, Thumb, relativeTime } from "@/components/studio";
import { AutoRefresh } from "@/components/client-helpers";
import { SetupChecklist } from "@/components/setup-checklist";
import { getDashboard } from "@/lib/queries";
import { categoryLabel } from "@/lib/constants";
import { previewUrl } from "@/lib/urls";

export default function DashboardPage() {
  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Opening episodes, continuations, and everything currently in production."
        actions={
          <Button asChild size="lg">
            <Link href="/generate">
              <Sparkles /> New batch
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
  const { stats, recentStories, recentRenders } = await getDashboard();
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
            description="Generate a batch of concepts to start your library. Concept mode costs only a few cents of text generation."
            action={
              <Button asChild>
                <Link href="/generate">Generate concepts</Link>
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
                    {categoryLabel(s.category)} · {s._count.episodes} ep · {relativeTime(s.lastActivityAt)}
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
