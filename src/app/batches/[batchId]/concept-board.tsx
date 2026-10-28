"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, Clapperboard, Copy } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ActionButton } from "@/components/client-helpers";
import { EmptyState } from "@/components/studio";
import { CRITERIA } from "@/lib/schemas/concept";
import { formatUsd } from "@/lib/costs/estimate";
import { produceEpisodes, promoteConcept } from "@/app/actions";
import { cn } from "@/lib/utils";

type Concept = {
  id: string;
  title: string;
  premise: string;
  logline: string;
  factMode: string;
  seriesPotential: string;
  status: "CANDIDATE" | "SELECTED" | "REJECTED" | "DUPLICATE";
  rank: number | null;
  totalScore: number | null;
  scores: (Record<string, { score: number; rationale: string }> & { summary?: string }) | null;
  duplicateOfTitle: string | null;
  similarity: number | null;
  storyId: string | null;
  episodeId: string | null;
  episodeStatus: string | null;
};

function ScoreBar({ score }: { score: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary" style={{ width: `${score * 10}%` }} />
      </div>
      <span className="w-4 text-xs tabular-nums">{score}</span>
    </div>
  );
}

function ConceptCard({ c, selectable, checked, onCheck }: { c: Concept; selectable: boolean; checked: boolean; onCheck: (v: boolean) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className={cn("rounded-xl border bg-card p-4", checked && "border-primary ring-2 ring-primary/10")}>
      <div className="flex gap-3">
        {selectable ? <Checkbox checked={checked} onCheckedChange={(v) => onCheck(Boolean(v))} aria-label={`Select ${c.title}`} className="mt-1" /> : null}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                {c.rank ? <span className="text-xs font-medium tabular-nums text-muted-foreground">#{c.rank}</span> : null}
                <h3 className="font-medium text-balance">{c.title}</h3>
              </div>
              <p className="mt-1 text-sm text-muted-foreground text-pretty">{c.premise}</p>
            </div>
            {c.totalScore != null ? (
              <div className="text-right">
                <div className="text-xl font-semibold tabular-nums">{c.totalScore.toFixed(1)}</div>
                <div className="text-[11px] text-muted-foreground">editorial score</div>
              </div>
            ) : null}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Badge variant="outline">{c.factMode.toLowerCase()}</Badge>
            {c.status === "DUPLICATE" ? (
              <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-800">
                <Copy /> Similar to “{c.duplicateOfTitle}” ({Math.round((c.similarity ?? 0) * 100)}%)
              </Badge>
            ) : null}
            {c.storyId ? (
              <Link href={`/stories/${c.storyId}`} className="text-xs font-medium underline-offset-4 hover:underline">
                Open story →
              </Link>
            ) : null}
            {c.scores ? (
              <Button variant="ghost" size="xs" onClick={() => setOpen((o) => !o)} className="ml-auto">
                Score rationale <ChevronDown className={cn("transition-transform", open && "rotate-180")} />
              </Button>
            ) : null}
          </div>
          {open && c.scores ? (
            <div className="mt-3 space-y-2 border-t pt-3">
              {c.scores.summary ? <p className="text-sm italic text-muted-foreground">{c.scores.summary}</p> : null}
              <p className="text-sm">
                <span className="font-medium">Series potential:</span> {c.seriesPotential}
              </p>
              <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
                {CRITERIA.map((k) => {
                  const s = c.scores?.[k.key];
                  if (!s) return null;
                  return (
                    <div key={k.key} className="text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-medium">{k.label}</span>
                        <ScoreBar score={s.score} />
                      </div>
                      <p className="mt-0.5 text-muted-foreground">{s.rationale}</p>
                    </div>
                  );
                })}
              </div>
              <p className="text-[11px] text-muted-foreground">Scores are AI editorial heuristics, not predictions of real audience performance.</p>
            </div>
          ) : null}
          {c.status === "REJECTED" && !c.storyId ? (
            <div className="mt-3">
              <ActionButton size="sm" variant="outline" action={() => promoteConcept(c.id)} success="Saved to the story library">
                Keep this concept anyway
              </ActionButton>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function ConceptBoard({ batchId, concepts, perEpisodeEstimate }: { batchId: string; concepts: Concept[]; perEpisodeEstimate: number }) {
  // Only the chosen concepts are shown; the other pitches stay behind a link as backups.
  const [showBackups, setShowBackups] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const groups = useMemo(
    () => ({
      selected: concepts.filter((c) => c.status === "SELECTED"),
      backups: concepts.filter((c) => c.status === "REJECTED" || c.status === "DUPLICATE"),
    }),
    [concepts],
  );
  const producible = groups.selected.filter((c) => c.episodeId && (c.episodeStatus === "DRAFT" || c.episodeStatus === "FAILED"));
  const pickedEpisodeIds = producible.filter((c) => picked.has(c.id)).map((c) => c.episodeId!);

  if (concepts.length === 0) return <EmptyState title="Concepts will appear here" description="Candidates are being pitched and scored. This page refreshes automatically." />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-base font-semibold tracking-tight">Your stories ({groups.selected.length})</h2>
        {producible.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => setPicked(new Set(picked.size === producible.length ? [] : producible.map((c) => c.id)))}>
              {picked.size === producible.length ? "Clear" : "Select all"}
            </Button>
            <ActionButton
              disabled={pickedEpisodeIds.length === 0}
              action={() => produceEpisodes(pickedEpisodeIds, batchId)}
              success="Production queued"
              onSuccess={() => setPicked(new Set())}
              confirm={{
                title: `Produce ${pickedEpisodeIds.length} episode${pickedEpisodeIds.length === 1 ? "" : "s"}?`,
                description: `Writes scripts, illustrates, narrates and renders each one. Estimated ≈ ${formatUsd(perEpisodeEstimate * pickedEpisodeIds.length)} total (≈ ${formatUsd(perEpisodeEstimate)} each), capped by the batch budget. Estimates are not guaranteed.`,
                confirmLabel: "Start production",
              }}
            >
              <Clapperboard /> Produce {pickedEpisodeIds.length || ""} selected
            </ActionButton>
          </div>
        ) : null}
      </div>
      <div className="grid gap-3">
        {groups.selected.map((c) => {
          const selectable = producible.includes(c);
          return (
            <ConceptCard
              key={c.id}
              c={c}
              selectable={selectable}
              checked={picked.has(c.id)}
              onCheck={(v) =>
                setPicked((prev) => {
                  const next = new Set(prev);
                  if (v) next.add(c.id);
                  else next.delete(c.id);
                  return next;
                })
              }
            />
          );
        })}
        {groups.selected.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">No stories were selected.</p> : null}
      </div>
      {groups.backups.length > 0 ? (
        <div className="space-y-3">
          <button type="button" onClick={() => setShowBackups(!showBackups)} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ChevronDown className={cn("size-4 transition-transform", showBackups && "rotate-180")} />
            {showBackups ? "Hide" : "Show"} {groups.backups.length} backup idea{groups.backups.length === 1 ? "" : "s"} that scored lower
          </button>
          {showBackups ? (
            <div className="grid gap-3">
              {groups.backups.map((c) => (
                <ConceptCard key={c.id} c={c} selectable={false} checked={false} onCheck={() => {}} />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
