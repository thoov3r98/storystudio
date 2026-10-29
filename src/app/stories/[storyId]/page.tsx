import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { EpisodeStatusBadge, Money, PageHeader, PageSkeleton, Section, StoryStatusBadge, Thumb, relativeTime } from "@/components/studio";
import { AutoRefresh } from "@/components/client-helpers";
import { getStory } from "@/lib/queries";
import { JOB_STATUS_LABELS } from "@/lib/constants";
import { ResearchRecordSchema } from "@/lib/schemas/process";
import { downloadUrl, previewUrl } from "@/lib/urls";
import { ApproveEpisodeButton, MetricsDialog, PublishDialog, StoryHeaderActions } from "./story-client";

export const metadata: Metadata = { title: "Story" };

export default function StoryPage(props: PageProps<"/stories/[storyId]">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <StoryContent params={props.params} />
    </Suspense>
  );
}

async function StoryContent({ params }: { params: PageProps<"/stories/[storyId]">["params"] }) {
  const { storyId } = await params;
  const data = await getStory(storyId);
  if (!data) notFound();
  const { story, costs } = data;
  const research = ResearchRecordSchema.safeParse(story.research);
  const activeJobs = story.episodes.flatMap((e) => e.jobs);
  const totalCost = costs.reduce((a, c) => a + c.usd, 0);

  return (
    <>
      <AutoRefresh active={activeJobs.length > 0} />
      <PageHeader
        eyebrow={
          <span className="flex flex-wrap items-center gap-2">
            <Link href="/stories" className="hover:underline">
              Story Library
            </Link>
            <span>/</span>{" "}
            {story.channel ? (
              <Link href={`/channels/${story.channel.id}`} className="hover:underline">
                {story.channel.name}
              </Link>
            ) : (
              "Before channels"
            )}
          </span>
        }
        title={story.title}
        description={story.premise}
        actions={<StoryHeaderActions storyId={story.id} title={story.title} archived={story.status === "ARCHIVED"} />}
      />

      <div className="mb-8 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
        <StoryStatusBadge status={story.status} />
        <span>{story.targetDurationSec}s episodes</span>
        <span>Created {story.createdAt.toLocaleDateString()}</span>
        <span>Active {relativeTime(story.lastActivityAt)}</span>
        <span>
          Production cost <Money value={totalCost} className="text-foreground" />
        </span>
      </div>

      <div className="grid gap-10 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="space-y-10">
          <Section title="Episodes" description="In chronological order.">
            <div className="space-y-3">
              {story.episodes.map((e) => {
                const v = e.currentVersion;
                const render = v?.renders[0];
                const job = e.jobs[0];
                return (
                  <div key={e.id} className="rounded-xl border bg-card p-4">
                    <div className="flex flex-col gap-4 sm:flex-row">
                      {render?.url ? (
                        <video src={previewUrl(render.url)} controls preload="metadata" className="aspect-[9/16] w-full shrink-0 rounded-lg border bg-black sm:w-36" />
                      ) : (
                        <Thumb src={e.partNumber === 1 ? story.thumbnailUrl : null} alt="" className="aspect-[9/16] w-24 shrink-0 sm:w-36" />
                      )}
                      <div className="min-w-0 flex-1 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Part {e.partNumber}</span>
                          <EpisodeStatusBadge status={e.status} />
                          {v ? <span className="text-xs text-muted-foreground">script v{v.version}</span> : null}
                        </div>
                        <Link href={`/episodes/${e.id}`} className="block font-medium hover:underline">
                          {e.title}
                        </Link>
                        {v ? <p className="line-clamp-3 text-sm text-muted-foreground">{v.summary}</p> : <p className="text-sm text-muted-foreground">No script yet.</p>}
                        {job ? (
                          <div className="space-y-1">
                            <div className="text-xs text-muted-foreground">
                              {JOB_STATUS_LABELS[job.status]} — {job.stage}
                            </div>
                            <Progress value={job.progress * 100} />
                          </div>
                        ) : null}
                        {e.publishedAt ? (
                          <p className="text-xs text-muted-foreground">
                            Published {e.publishedAt.toLocaleDateString()}
                            {e.publishedPlatform ? ` on ${e.publishedPlatform}` : ""}
                            {e.publishedUrl ? (
                              <>
                                {" "}
                                ·{" "}
                                <a href={e.publishedUrl} target="_blank" rel="noreferrer" className="underline">
                                  link
                                </a>
                              </>
                            ) : null}
                          </p>
                        ) : null}
                        {e.metrics.length ? (
                          <p className="text-xs text-muted-foreground">
                            Latest metrics ({e.metrics[0].platform}): {e.metrics[0].views?.toLocaleString() ?? "—"} views · {e.metrics[0].likes?.toLocaleString() ?? "—"} likes ·{" "}
                            {e.metrics[0].completionRate != null ? `${e.metrics[0].completionRate}% completion` : "completion —"}
                          </p>
                        ) : null}
                        <div className="flex flex-wrap gap-2 pt-1">
                          <Button asChild size="sm" variant="outline">
                            <Link href={`/episodes/${e.id}`}>Open episode</Link>
                          </Button>
                          {render?.url ? (
                            <Button asChild size="sm" variant="outline">
                              <a href={downloadUrl(render.url)} download>
                                <Download /> MP4
                              </a>
                            </Button>
                          ) : null}
                          {e.status === "READY" ? <ApproveEpisodeButton episodeId={e.id} /> : null}
                          {e.status === "APPROVED" || e.status === "PUBLISHED" ? (
                            <PublishDialog episodeId={e.id} published={e.status === "PUBLISHED"} />
                          ) : null}
                          {e.status === "PUBLISHED" ? <MetricsDialog episodeId={e.id} /> : null}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </Section>
        </div>

        <div className="space-y-10">
          <Section title="Research" description={research.success ? `Gathered ${new Date(research.data.researchedAt).toLocaleDateString()}. Every script is written and fact-checked from it.` : undefined}>
            <div className="rounded-xl border bg-card p-5 text-sm">
              {research.success ? (
                <div className="space-y-3">
                  <p>{research.data.overview}</p>
                  {research.data.mainRoute ? <p className="text-muted-foreground">Main route: {research.data.mainRoute}</p> : null}
                  <ol className="ml-4 list-decimal space-y-1 text-xs text-muted-foreground">
                    {research.data.sources.map((src) => (
                      <li key={src.n}>
                        <a href={src.url} target="_blank" rel="noreferrer" className="underline">
                          {src.title}
                        </a>
                      </li>
                    ))}
                  </ol>
                </div>
              ) : (
                <p className="text-muted-foreground">Not researched yet. Writing Part 1 researches the product first.</p>
              )}
            </div>
          </Section>

          <Section title="Production costs" description="Estimated from configured pricing and recorded usage.">
            <div className="rounded-xl border bg-card p-4 text-sm">
              {costs.length === 0 ? (
                <p className="text-muted-foreground">Nothing spent yet.</p>
              ) : (
                <dl className="space-y-1.5">
                  {costs.map((c) => (
                    <div key={c.provider} className="flex justify-between">
                      <dt className="text-muted-foreground">{c.provider.replace("_", " ").toLowerCase()}</dt>
                      <dd>
                        <Money value={c.usd} />
                      </dd>
                    </div>
                  ))}
                  <div className="flex justify-between border-t pt-1.5 font-medium">
                    <dt>Total</dt>
                    <dd>
                      <Money value={totalCost} />
                    </dd>
                  </div>
                </dl>
              )}
            </div>
          </Section>
        </div>
      </div>
    </>
  );
}
