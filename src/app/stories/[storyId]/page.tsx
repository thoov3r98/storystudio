import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Download, Flag } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { EpisodeStatusBadge, Money, PageHeader, PageSkeleton, Section, StoryStatusBadge, Thumb, relativeTime } from "@/components/studio";
import { AutoRefresh } from "@/components/client-helpers";
import { getStory } from "@/lib/queries";
import { categoryLabel, ILLUSTRATION_STYLES, JOB_STATUS_LABELS } from "@/lib/constants";
import { StoryBibleSchema, StoryBibleUpdateSchema, type StoryBible } from "@/lib/schemas/story-bible";
import { continuationBlockers } from "@/lib/pipeline/context";
import { downloadUrl, previewUrl } from "@/lib/urls";
import { ApproveEpisodeButton, BibleEditor, MetricsDialog, NextEpisodeButton, PublishDialog, StoryHeaderActions } from "./story-client";

export const metadata: Metadata = { title: "Story" };

export default function StoryPage(props: PageProps<"/stories/[storyId]">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <StoryContent params={props.params} />
    </Suspense>
  );
}

function List({ items, empty }: { items: React.ReactNode[]; empty: string }) {
  if (items.length === 0) return <p className="text-sm text-muted-foreground">{empty}</p>;
  return <ul className="space-y-1.5 text-sm">{items.map((item, i) => <li key={i}>{item}</li>)}</ul>;
}

function BibleView({ bible }: { bible: StoryBible }) {
  const open = bible.unresolvedThreads.filter((t) => t.status === "open");
  const resolved = bible.unresolvedThreads.filter((t) => t.status === "resolved");
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Premise</h3>
        <p className="mt-1 text-sm">{bible.premise}</p>
        <p className="mt-2 text-xs text-muted-foreground">
          Tone: {bible.tone} · {bible.narrativePerspective}
        </p>
      </div>
      {bible.arcSummary ? (
        <div>
          <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Series so far</h3>
          <p className="mt-1 text-sm">{bible.arcSummary}</p>
        </div>
      ) : null}
      <div>
        <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Unresolved questions</h3>
        <div className="mt-2">
          <List
            empty="None recorded yet. Threads are added when an episode is approved."
            items={open.map((t) => (
              <span key={t.id}>
                <Badge variant="outline" className="mr-1.5 font-mono text-[10px]">
                  {t.id}
                </Badge>
                {t.description} <span className="text-xs text-muted-foreground">· since Part {t.introducedPart}</span>
              </span>
            ))}
          />
        </div>
      </div>
      <div>
        <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Characters</h3>
        <div className="mt-2">
          <List
            empty="No characters yet."
            items={bible.characters.map((c) => (
              <span key={c.name}>
                <span className="font-medium">{c.name}</span> <span className="text-muted-foreground">({c.role})</span> — {c.description}
                <span className="block text-xs text-muted-foreground">Drawn as: {c.visualDescription}</span>
              </span>
            ))}
          />
        </div>
      </div>
      <div>
        <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Locations</h3>
        <div className="mt-2">
          <List empty="No locations yet." items={bible.locations.map((l) => <span key={l.name}><span className="font-medium">{l.name}</span> — {l.description}</span>)} />
        </div>
      </div>
      <div>
        <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Timeline</h3>
        <ol className="mt-2 space-y-1.5 border-l pl-4 text-sm">
          {bible.timeline.length === 0 ? <li className="list-none text-muted-foreground">No events yet.</li> : null}
          {bible.timeline.map((e, i) => (
            <li key={i}>
              <span className="text-xs tabular-nums text-muted-foreground">Part {e.part}.{e.order}</span> {e.event}
            </li>
          ))}
        </ol>
      </div>
      <div>
        <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Established facts</h3>
        <div className="mt-2">
          <List
            empty="None yet."
            items={[...bible.establishedFacts, ...bible.technicalFacts].map((f, i) => (
              <span key={i}>
                <Badge variant="outline" className={f.kind === "real-world" ? "mr-1.5 border-sky-200 bg-sky-50 text-sky-800" : "mr-1.5"}>
                  {f.kind}
                </Badge>
                {f.statement}
              </span>
            ))}
          />
        </div>
      </div>
      {bible.revealedInformation.length ? (
        <div>
          <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Already revealed</h3>
          <div className="mt-2">
            <List empty="" items={bible.revealedInformation} />
          </div>
        </div>
      ) : null}
      {bible.mysteries.length ? (
        <div>
          <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Known mysteries</h3>
          <div className="mt-2">
            <List empty="" items={bible.mysteries} />
          </div>
        </div>
      ) : null}
      {bible.constraints.length ? (
        <div>
          <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Constraints for future episodes</h3>
          <div className="mt-2">
            <List empty="" items={bible.constraints} />
          </div>
        </div>
      ) : null}
      {resolved.length ? (
        <div>
          <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Resolved threads</h3>
          <div className="mt-2">
            <List empty="" items={resolved.map((t) => `${t.description} → ${t.resolution ?? "resolved"} (Part ${t.resolvedPart})`)} />
          </div>
        </div>
      ) : null}
      <div>
        <h3 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Visual style</h3>
        <p className="mt-1 text-sm">
          {ILLUSTRATION_STYLES[bible.visualStyle.styleKey as keyof typeof ILLUSTRATION_STYLES]?.label ?? bible.visualStyle.styleKey}
          {bible.visualStyle.notes ? ` — ${bible.visualStyle.notes}` : ""}
        </p>
        {bible.visualStyle.recurringVisuals.length ? (
          <div className="mt-2">
            <List empty="" items={bible.visualStyle.recurringVisuals.map((v) => `${v.name}: ${v.description}`)} />
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ProposalSummary({ update }: { update: unknown }) {
  const parsed = StoryBibleUpdateSchema.safeParse(update);
  if (!parsed.success) return <p className="text-sm text-destructive">Proposal is malformed and cannot be applied.</p>;
  const u = parsed.data;
  const rows: [string, string[]][] = [
    ["New characters", u.addCharacters.map((c) => `${c.name} — ${c.description}`)],
    ["Character changes", u.updateCharacters.map((c) => `${c.name}: ${[c.description, c.visualDescription].filter(Boolean).join(" / ")}`)],
    ["New locations", u.addLocations.map((l) => l.name)],
    ["Timeline events", u.addTimelineEvents.map((e) => e.event)],
    ["Established facts", [...u.addEstablishedFacts, ...u.addTechnicalFacts].map((f) => `[${f.kind}] ${f.statement}`)],
    ["Opens threads", u.openThreads.map((t) => `${t.id}: ${t.description}`)],
    ["Resolves threads", u.resolveThreads.map((t) => `${t.id}: ${t.resolution}`)],
    ["Reveals", u.addRevealedInformation],
    ["New constraints", u.addConstraints],
  ];
  return (
    <div className="space-y-2 text-sm">
      {rows
        .filter(([, items]) => items.length)
        .map(([label, items]) => (
          <div key={label}>
            <span className="text-xs font-medium text-muted-foreground">{label}</span>
            <ul className="ml-4 list-disc">
              {items.map((i, k) => (
                <li key={k}>{i}</li>
              ))}
            </ul>
          </div>
        ))}
      {u.arcSummary ? (
        <p className="text-xs text-muted-foreground">
          <span className="font-medium">Updated series summary:</span> {u.arcSummary}
        </p>
      ) : null}
    </div>
  );
}

async function StoryContent({ params }: { params: PageProps<"/stories/[storyId]">["params"] }) {
  const { storyId } = await params;
  const data = await getStory(storyId);
  if (!data) notFound();
  const { story, costs } = data;
  const canonical = story.bibles[0];
  const bible = canonical ? StoryBibleSchema.safeParse(canonical.data) : null;
  const blockers = await continuationBlockers(story.id);
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
            <span>/</span> {categoryLabel(story.category)}
            {story.character ? (
              <>
                <span>·</span>
                <Link href={`/characters/${story.character.id}`} className="inline-flex items-center gap-1.5 hover:underline">
                  <span className="size-2.5 rounded-full" style={{ backgroundColor: story.character.signatureColor }} aria-hidden />
                  Starring {story.character.name}
                </Link>
              </>
            ) : null}
          </span>
        }
        title={story.title}
        description={story.premise}
        actions={
          <>
            <StoryHeaderActions storyId={story.id} title={story.title} archived={story.status === "ARCHIVED"} />
            <NextEpisodeButton storyId={story.id} blockers={blockers} nextPart={story.episodes.length + 1} />
          </>
        }
      />

      <div className="mb-8 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
        <StoryStatusBadge status={story.status} />
        <span>{story.factMode.toLowerCase()} story</span>
        <span>{story.targetDurationSec}s episodes</span>
        <span>Created {story.createdAt.toLocaleDateString()}</span>
        <span>Active {relativeTime(story.lastActivityAt)}</span>
        <span>
          Production cost <Money value={totalCost} className="text-foreground" />
        </span>
      </div>

      <div className="grid gap-10 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="space-y-10">
          {story.proposals.length ? (
            <Section title="Proposed continuity updates" description="These changes become canonical only when you approve the episode that proposed them.">
              <div className="space-y-3">
                {story.proposals.map((p) => (
                  <div key={p.id} className="rounded-xl border border-violet-200 bg-violet-50/40 p-4">
                    <div className="mb-2 text-sm font-medium">
                      From Part {p.episodeVersion.episode.partNumber}: {p.episodeVersion.episode.title}{" "}
                      <span className="text-xs font-normal text-muted-foreground">(script v{p.episodeVersion.version})</span>
                    </div>
                    <ProposalSummary update={p.update} />
                  </div>
                ))}
              </div>
            </Section>
          ) : null}

          <Section title="Episodes" description="In chronological order.">
            <div className="space-y-3">
              {story.episodes.map((e) => {
                const v = e.currentVersion;
                const render = v?.renders[0];
                const job = e.jobs[0];
                const flagged = v?.claims.length ?? 0;
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
                          {flagged ? (
                            <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-800">
                              <Flag /> {flagged} claim{flagged === 1 ? "" : "s"} to verify
                            </Badge>
                          ) : null}
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
                          {e.status === "READY" ? <ApproveEpisodeButton episodeId={e.id} hasProposal={v?.proposal?.status === "PENDING"} /> : null}
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
          <Section
            title="Story bible"
            description={canonical ? `Canonical v${canonical.version} · ${canonical.source.replace("-", " ")}` : undefined}
            actions={bible?.success ? <BibleEditor storyId={story.id} json={JSON.stringify(bible.data, null, 2)} /> : null}
          >
            <div className="rounded-xl border bg-card p-5">
              {bible?.success ? <BibleView bible={bible.data} /> : <p className="text-sm text-muted-foreground">No story bible yet.</p>}
            </div>
            {story.bibles.length > 1 ? (
              <details className="text-sm">
                <summary className="cursor-pointer text-muted-foreground">Bible version history ({story.bibles.length})</summary>
                <ul className="mt-2 space-y-1">
                  {story.bibles.map((b) => (
                    <li key={b.id} className="text-xs text-muted-foreground">
                      v{b.version} · {b.source} · {b.createdAt.toLocaleString()} {b.note ? `— ${b.note}` : ""}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
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
