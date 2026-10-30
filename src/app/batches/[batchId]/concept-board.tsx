"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown, Copy, PenLine } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ActionButton } from "@/components/client-helpers";
import { EmptyState } from "@/components/studio";
import { writePitch } from "@/app/actions";
import { cn } from "@/lib/utils";
import { EvidenceLevelBadge, EvidenceList, ScoreBreakdown, StrategyBadge, TopicAngle, TopicScore } from "@/components/topic-evidence";
import type { DiscoverySnapshot } from "@/lib/schemas/topics";

type Pitch = {
  id: string;
  title: string;
  premise: string;
  logline: string;
  arc: string;
  status: "CANDIDATE" | "SELECTED" | "REJECTED" | "DUPLICATE";
  rank: number | null;
  reason: string | null;
  duplicateOfTitle: string | null;
  storyId: string | null;
  discovery: DiscoverySnapshot | null;
};

function PitchCard({ p, canWrite, writingElsewhere }: { p: Pitch; canWrite: boolean; writingElsewhere: boolean }) {
  const d = p.discovery;
  return (
    <div className={cn("rounded-xl border bg-card p-4", p.storyId && "border-primary/40")}>
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-medium text-balance">{p.title}</h3>
        {d?.score != null ? <TopicScore score={d.score} /> : null}
      </div>
      <p className="mt-1 text-sm text-pretty">{p.premise}</p>
      {d ? (
        <div className="mt-3 space-y-2">
          <div className="flex flex-wrap gap-1.5">
            {d.generation !== "library-match" ? <StrategyBadge strategy={d.strategy} /> : null}
            <EvidenceLevelBadge level={d.evidenceLevel} />
          </div>
          <TopicAngle d={d} />
          <EvidenceList evidence={d.evidence} />
          <ScoreBreakdown breakdown={d.breakdown} />
        </div>
      ) : null}
      {p.arc ? <p className="mt-2 text-sm text-muted-foreground text-pretty">{p.arc}</p> : null}
      {p.reason && !d ? <p className="mt-2 text-xs italic text-muted-foreground">{p.reason}</p> : null}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {p.status === "DUPLICATE" ? (
          <Badge variant="outline" className="border-amber-200 bg-amber-50 text-amber-800">
            <Copy /> Close to “{p.duplicateOfTitle}”
          </Badge>
        ) : null}
        {p.storyId ? (
          <Link href={`/stories/${p.storyId}`} className="text-sm font-medium underline-offset-4 hover:underline">
            Open story →
          </Link>
        ) : canWrite && p.status !== "DUPLICATE" ? (
          <ActionButton
            size="sm"
            variant={writingElsewhere ? "outline" : "default"}
            action={() => writePitch(p.id)}
            confirm={{
              title: `Write “${p.title}”?`,
              description:
                "Plans the whole story, writes and checks the script for every part, then stops so you can review them. Images, narration and rendering start only when you approve a part.",
              confirmLabel: "Write it",
            }}
          >
            <PenLine /> Write this story
          </ActionButton>
        ) : null}
      </div>
    </div>
  );
}

export function PitchBoard({ concepts, canWrite }: { concepts: Pitch[]; canWrite: boolean }) {
  const [showMore, setShowMore] = useState(false);
  const shown = concepts.filter((c) => c.status === "CANDIDATE" || c.status === "SELECTED");
  const more = concepts.filter((c) => c.status === "REJECTED" || c.status === "DUPLICATE");
  const written = concepts.some((c) => c.storyId);

  if (concepts.length === 0) return <EmptyState title="Pitches will appear here" description="Ideas are being pitched and picked. This page refreshes automatically." />;

  return (
    <div className="space-y-4">
      <h2 className="text-base font-semibold tracking-tight">Pick one</h2>
      <div className="grid gap-3 lg:grid-cols-3">
        {shown.map((p) => (
          <PitchCard key={p.id} p={p} canWrite={canWrite} writingElsewhere={written} />
        ))}
      </div>
      {more.length > 0 ? (
        <div className="space-y-3">
          <button type="button" onClick={() => setShowMore(!showMore)} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ChevronDown className={cn("size-4 transition-transform", showMore && "rotate-180")} />
            {showMore ? "Hide" : "Show"} {more.length} other pitch{more.length === 1 ? "" : "es"}
          </button>
          {showMore ? (
            <div className="grid gap-3 lg:grid-cols-3">
              {more.map((p) => (
                <PitchCard key={p.id} p={p} canWrite={canWrite} writingElsewhere={written} />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
