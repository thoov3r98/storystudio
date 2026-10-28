import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { AlertTriangle, Download } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { EpisodeStatusBadge, JobStatusBadge, Money, PageHeader, PageSkeleton, Section, relativeTime } from "@/components/studio";
import { AutoRefresh } from "@/components/client-helpers";
import { getEpisode } from "@/lib/queries";
import { reconcileStaleJobs } from "@/lib/enqueue";
import { ACTIVE_JOB_STATUSES } from "@/lib/constants";
import type { ContinuityReview, EpisodeSpecRecord } from "@/lib/schemas/episode";
import type { EpisodeTiming } from "@/lib/timing";
import { downloadUrl, previewUrl } from "@/lib/urls";
import { ApproveEpisodeButton } from "@/app/stories/[storyId]/story-client";
import { EpisodeActionButton, RewriteSceneDialog, SceneImageHistory, VersionRestoreButton } from "./episode-client";

export const metadata: Metadata = { title: "Episode" };

export default function EpisodePage(props: PageProps<"/episodes/[episodeId]">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <EpisodeContent params={props.params} />
    </Suspense>
  );
}

function fmtMs(ms: number) {
  const s = ms / 1000;
  return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;
}

async function EpisodeContent({ params }: { params: PageProps<"/episodes/[episodeId]">["params"] }) {
  const { episodeId } = await params;
  await reconcileStaleJobs();
  const data = await getEpisode(episodeId);
  if (!data) notFound();
  const { episode, latestRender, staleness, costUsd } = data;
  const v = episode.currentVersion;
  const spec = (v?.spec ?? null) as Partial<EpisodeSpecRecord> | null;
  const timing = (v?.timing ?? null) as EpisodeTiming | null;
  const activeJob = episode.jobs.find((j) => ACTIVE_JOB_STATUSES.includes(j.status));
  const latestRenderAttempt = v?.renders[0];
  const locked = v?.status === "APPROVED";
  const continuity = (v?.continuityReview ?? null) as ContinuityReview | null;
  const busy = Boolean(activeJob);

  return (
    <>
      <AutoRefresh active={busy} intervalMs={3500} />
      <PageHeader
        eyebrow={
          <span className="flex flex-wrap items-center gap-2">
            <Link href={`/stories/${episode.storyId}`} className="hover:underline">
              {episode.story.title}
            </Link>
            <span>/</span> Part {episode.partNumber}
          </span>
        }
        title={episode.title}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <EpisodeStatusBadge status={episode.status} />
            {v ? (
              <span>
                Script v{v.version}
                {locked ? " (locked)" : ""}
              </span>
            ) : null}
            <span>
              Cost <Money value={costUsd} />
            </span>
          </span>
        }
        actions={
          <>
            {!v || episode.status === "DRAFT" ? (
              <EpisodeActionButton episodeId={episode.id} request={{ action: "produce", allowContinuityConflicts: false }} disabled={busy} label="Write & produce" primary />
            ) : null}
            {v && episode.status === "SCRIPTED" ? (
              <EpisodeActionButton episodeId={episode.id} request={{ action: "render" }} disabled={busy} label="Produce video" primary />
            ) : null}
            {v && episode.status === "FAILED" ? (
              <>
                <EpisodeActionButton episodeId={episode.id} request={{ action: "render" }} disabled={busy} label="Resume production" primary />
                {continuity?.verdict === "material-conflicts" ? (
                  <EpisodeActionButton
                    episodeId={episode.id}
                    request={{ action: "regenerate-script", allowContinuityConflicts: true }}
                    disabled={busy}
                    label="Rewrite & produce anyway"
                    confirm="Continuity conflicts remain. This rewrites the script and continues production even if material conflicts persist."
                  />
                ) : null}
              </>
            ) : null}
            {latestRender?.url ? (
              <Button asChild variant="outline">
                <a href={downloadUrl(latestRender.url)} download>
                  <Download /> Download MP4
                </a>
              </Button>
            ) : null}
            {episode.status === "READY" ? <ApproveEpisodeButton episodeId={episode.id} hasProposal={v?.proposal?.status === "PENDING"} /> : null}
          </>
        }
      />

      {activeJob ? (
        <div className="mb-8 rounded-xl border bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <JobStatusBadge status={activeJob.status} />
              <span className="text-sm text-muted-foreground">{activeJob.stage}</span>
            </div>
            <span className="text-sm tabular-nums text-muted-foreground">{Math.round(activeJob.progress * 100)}%</span>
          </div>
          <Progress value={activeJob.progress * 100} className="mt-3" />
        </div>
      ) : null}

      {staleness && v && !busy && (staleness.renderOutdated || (staleness.renderMissing && episode.status !== "DRAFT" && episode.status !== "SCRIPTED")) ? (
        <div className="mb-8 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50/70 p-4 text-sm">
          <span className="flex items-center gap-2">
            <AlertTriangle className="size-4 text-warning" />
            {staleness.renderOutdated
              ? "Images or narration changed since the last render. The MP4 is out of date."
              : `Not rendered yet${staleness.missingImages.length ? ` — ${staleness.missingImages.length} scene image(s) missing` : ""}${staleness.voiceoverMissing ? " — voiceover missing" : ""}.`}
          </span>
          <EpisodeActionButton episodeId={episode.id} request={{ action: "render" }} label={staleness.readyToRender ? "Render now" : "Finish production"} size="sm" />
        </div>
      ) : null}

      {latestRenderAttempt?.status === "FAILED" && !busy ? (
        <div className="mb-8 rounded-xl border border-red-200 bg-red-50/60 p-4 text-sm text-red-800">Last render failed: {latestRenderAttempt.error}</div>
      ) : null}

      {!v ? (
        <div className="rounded-xl border border-dashed bg-card p-8 text-center text-sm text-muted-foreground">
          No script yet. <span className="font-medium text-foreground">Write &amp; produce</span> outlines the episode, writes the script and makes the video.
        </div>
      ) : (
        <div className="grid gap-10 xl:grid-cols-[360px_minmax(0,1fr)]">
          <div className="space-y-8 xl:sticky xl:top-8 xl:self-start">
            <div className="space-y-3">
              {latestRender?.url ? (
                <video key={latestRender.id} src={previewUrl(latestRender.url)} controls playsInline preload="metadata" className="aspect-[9/16] w-full rounded-xl border bg-black" />
              ) : (
                <div className="grid aspect-[9/16] w-full place-items-center rounded-xl border border-dashed bg-card text-sm text-muted-foreground">No video yet</div>
              )}
              <div className="flex flex-wrap gap-2">
                <EpisodeActionButton
                  episodeId={episode.id}
                  request={{ action: "render" }}
                  disabled={busy || !staleness?.readyToRender}
                  label={latestRender ? "Re-render MP4" : "Render MP4"}
                  size="sm"
                />
              </div>
              {v.renders.length ? (
                <details className="text-xs text-muted-foreground">
                  <summary className="cursor-pointer">Render history ({v.renders.length})</summary>
                  <ul className="mt-2 space-y-1">
                    {v.renders.map((r) => (
                      <li key={r.id}>
                        r{r.version} · {r.status.toLowerCase()} · {relativeTime(r.createdAt)}
                        {r.sizeBytes ? ` · ${(r.sizeBytes / 1_048_576).toFixed(1)} MB` : ""}
                        {r.url ? (
                          <>
                            {" "}
                            ·{" "}
                            <a className="underline" href={downloadUrl(r.url)} download>
                              download
                            </a>
                          </>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </div>

            <div className="space-y-2 rounded-xl border bg-card p-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium">Voiceover</h3>
                <EpisodeActionButton episodeId={episode.id} request={{ action: "regenerate-voiceover" }} disabled={busy} label="Regenerate" size="xs" variant="outline" confirm={locked ? "This version is approved; a new draft version will be created first." : undefined} />
              </div>
              {v.voiceover?.url ? (
                <>
                  <audio src={previewUrl(v.voiceover.url)} controls className="w-full" preload="metadata" />
                  <p className="text-xs text-muted-foreground">
                    {v.voiceover.durationMs ? `${(v.voiceover.durationMs / 1000).toFixed(1)}s actual` : ""} · {v.voiceover.characterCount} characters · voice {v.voiceover.voiceId.slice(0, 8)}…
                  </p>
                </>
              ) : (
                <p className="text-xs text-muted-foreground">Not generated for this script version.</p>
              )}
            </div>

            <div className="space-y-2 rounded-xl border bg-card p-4 text-sm">
              <h3 className="font-medium">Script versions</h3>
              <ul className="space-y-1.5">
                {episode.versions.map((ver) => (
                  <li key={ver.id} className="flex items-center justify-between gap-2 text-xs">
                    <span className={ver.id === v.id ? "font-medium" : "text-muted-foreground"}>
                      v{ver.version} · {ver.reason} · {ver.status.toLowerCase()} · {relativeTime(ver.createdAt)}
                    </span>
                    {ver.id !== v.id ? <VersionRestoreButton episodeId={episode.id} versionId={ver.id} disabled={busy} /> : <Badge variant="outline">current</Badge>}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="min-w-0 space-y-10">
            <Section
              title="Script"
              description={`${v.wordCount} words · ~${v.estimatedDurationSec.toFixed(0)}s estimated${timing ? ` · ${(timing.totalDurationMs / 1000).toFixed(1)}s actual` : ""}`}
              actions={
                <EpisodeActionButton
                  episodeId={episode.id}
                  request={{ action: "regenerate-script", allowContinuityConflicts: false }}
                  disabled={busy}
                  label="Regenerate script"
                  size="sm"
                  variant="outline"
                  confirm="Writes a new script version. Its scenes get new images, a new voiceover and a new render. The current version is kept in history."
                />
              }
            >
              <div className="space-y-4 rounded-xl border bg-card p-5">
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Opening</div>
                    <RewriteSceneDialog episodeId={episode.id} sceneNumber={1} disabled={busy} opening />
                  </div>
                  <p className="mt-1 text-lg font-medium text-balance">{spec?.selectedHook}</p>
                </div>
                <div>
                  <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Summary</div>
                  <p className="mt-1 text-sm">{v.summary}</p>
                </div>
                <details>
                  <summary className="cursor-pointer text-sm font-medium">Full narration</summary>
                  <p className="mt-2 text-sm leading-relaxed whitespace-pre-line">{v.narration}</p>
                </details>
                <div className="grid gap-4 text-sm sm:grid-cols-2">
                  {(
                    [
                      ["Key reveals", spec?.keyReveals],
                      ["Unresolved questions", spec?.unresolvedQuestions],
                    ] as const
                  ).map(([label, items]) => (
                    <div key={label}>
                      <div className="text-xs font-medium text-muted-foreground">{label}</div>
                      <ul className="mt-1 ml-4 list-disc space-y-1">
                        {(items ?? []).map((i, k) => (
                          <li key={k}>{i}</li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>
            </Section>

            <Section title={`Scene timeline (${v.scenes.length})`} description="Each scene holds one illustration while its narration plays. Timing comes from the real voiceover alignment.">
              <div className="space-y-3">
                {v.scenes.map((s) => {
                  const t = timing?.scenes.find((x) => x.sceneNumber === s.sceneNumber);
                  const img = s.currentImage;
                  const lastAttempt = s.images[0];
                  return (
                    <div key={s.id} className="flex flex-col gap-4 rounded-xl border bg-card p-4 sm:flex-row">
                      <div className="w-full shrink-0 sm:w-40">
                        <div className="aspect-[2/3] overflow-hidden rounded-lg border bg-[#FAFAF7]">
                          {img?.url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={img.url} alt={`Scene ${s.sceneNumber}`} className="h-full w-full object-cover" loading="lazy" />
                          ) : (
                            <div className="grid h-full place-items-center p-2 text-center text-xs text-muted-foreground">
                              {lastAttempt?.status === "FAILED" ? `Failed: ${lastAttempt.error?.slice(0, 120)}` : lastAttempt?.status === "GENERATING" ? "Generating…" : "No image yet"}
                            </div>
                          )}
                        </div>
                        <SceneImageHistory
                          episodeId={episode.id}
                          sceneNumber={s.sceneNumber}
                          currentImageId={s.currentImageId}
                          images={s.images.filter((i) => i.status === "SUCCEEDED" && i.url).map((i) => ({ id: i.id, url: i.url!, version: i.version }))}
                          disabled={busy}
                        />
                      </div>
                      <div className="min-w-0 flex-1 space-y-2">
                        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                          <span className="font-medium text-foreground">Scene {s.sceneNumber}</span>
                          {t ? (
                            <span className="tabular-nums">
                              {fmtMs(t.startMs)}–{fmtMs(t.endMs)}
                            </span>
                          ) : (
                            <span>~{s.intendedDurationSec.toFixed(0)}s planned</span>
                          )}
                          <Badge variant="outline">{s.motionPreset}</Badge>
                          {img?.usedReference ? <Badge variant="outline">style-referenced</Badge> : null}
                        </div>
                        <p className="text-sm">{s.narration}</p>
                        <p className="text-xs text-muted-foreground">
                          <span className="font-medium">Visual:</span> {s.imagePrompt}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          <span className="font-medium">Composition:</span> {s.composition}
                          {s.characters.length ? ` · Characters: ${s.characters.join(", ")}` : ""}
                          {s.objects.length ? ` · Objects: ${s.objects.join(", ")}` : ""}
                        </p>
                        <div className="flex flex-wrap gap-2 pt-1">
                          <EpisodeActionButton
                            episodeId={episode.id}
                            request={{ action: "regenerate-image", sceneNumbers: [s.sceneNumber] }}
                            disabled={busy}
                            label="Regenerate image"
                            size="xs"
                            variant="outline"
                            confirm={`Replaces scene ${s.sceneNumber}'s image (the old one stays in history) and re-renders the video.${locked ? " This version is approved, so a new draft version is created first." : ""}`}
                          />
                          <RewriteSceneDialog episodeId={episode.id} sceneNumber={s.sceneNumber} disabled={busy} />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Section>

            {continuity ? (
              <Section title="Continuity check" description={`Verdict: ${continuity.verdict.replace("-", " ")}`}>
                <div className="space-y-2">
                  {continuity.issues.length === 0 ? <p className="text-sm text-muted-foreground">No continuity issues found.</p> : null}
                  {continuity.issues.map((i, k) => (
                    <div key={k} className={`rounded-xl border p-3 text-sm ${i.severity === "material" ? "border-red-200 bg-red-50/50" : "bg-card"}`}>
                      <span className="text-xs font-medium">
                        {i.severity} · {i.type}
                        {i.sceneNumber ? ` · scene ${i.sceneNumber}` : ""}
                      </span>
                      <p className="mt-1">{i.description}</p>
                      <p className="mt-1 text-xs text-muted-foreground">Suggested fix: {i.suggestedFix}</p>
                    </div>
                  ))}
                </div>
              </Section>
            ) : null}

            <Section title="Jobs for this episode">
              <ul className="divide-y rounded-xl border bg-card text-sm">
                {episode.jobs.length === 0 ? <li className="p-3 text-muted-foreground">No jobs yet.</li> : null}
                {episode.jobs.map((j) => (
                  <li key={j.id} className="flex flex-wrap items-center justify-between gap-2 p-3">
                    <span className="flex items-center gap-2">
                      <JobStatusBadge status={j.status} />
                      <span className="text-muted-foreground">{j.type.replaceAll("_", " ").toLowerCase()}</span>
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {relativeTime(j.createdAt)}
                      {j.status === "FAILED" ? ` · ${(j.error as { message?: string } | null)?.message?.slice(0, 140) ?? ""}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
              <Link href="/jobs" className="text-xs underline-offset-4 hover:underline">
                Retry or cancel jobs on the Generation Jobs page →
              </Link>
            </Section>
          </div>
        </div>
      )}
    </>
  );
}
