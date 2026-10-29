import { Suspense } from "react";
import { connection } from "next/server";
import Link from "next/link";
import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import { PageHeader, PageSkeleton, Section } from "@/components/studio";
import { db } from "@/lib/db";
import { BUILT_IN_REFERENCES } from "@/lib/story/references";
import { ReferenceForm, ReferenceRowActions } from "./reference-client";

export const metadata: Metadata = { title: "Reference stories" };

export default function ReferencesPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ReferencesContent />
    </Suspense>
  );
}

function Meta({ items }: { items: string[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.filter(Boolean).map((i) => (
        <Badge key={i} variant="outline">
          {i}
        </Badge>
      ))}
    </div>
  );
}

async function ReferencesContent() {
  await connection();
  const rows = await db.referenceStory.findMany({ orderBy: { createdAt: "desc" } });
  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/quality" className="hover:underline">
            Story Quality
          </Link>
        }
        title="Reference stories"
        description="Scripts the writer studies for craft: how fast a premise lands, how setups pay off, how little explaining is needed. Up to two of the closest matches (by story type, hook and ending) are shown to the writer for each episode; they are never copied."
      />
      <div className="space-y-10">
        <Section title="Add a reference" description="Paste a script or transcript you own or have permission to use, and tag it so it is picked for the right stories.">
          <ReferenceForm />
        </Section>

        <Section title={`Your references (${rows.length})`}>
          {rows.length === 0 ? <p className="text-sm text-muted-foreground">None yet. The built-in examples below are used until you add your own.</p> : null}
          <div className="space-y-3">
            {rows.map((r) => (
              <div key={r.id} className={`rounded-xl border bg-card p-4 ${r.active ? "" : "opacity-60"}`}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="space-y-1.5">
                    <div className="font-medium">{r.title}</div>
                    <Meta items={[r.archetype, r.hookStyle, r.endingType, r.tone, r.active ? "" : "paused"]} />
                  </div>
                  <ReferenceRowActions id={r.id} active={r.active} />
                </div>
                {r.qualities.length ? <p className="mt-2 text-xs text-muted-foreground">Good at: {r.qualities.join(" · ")}</p> : null}
                <details className="mt-2 text-sm">
                  <summary className="cursor-pointer text-xs text-muted-foreground">Script</summary>
                  <p className="mt-1 whitespace-pre-line">{r.text}</p>
                </details>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Built-in examples" description="Original stories written for Story Studio as starting material. They show different shapes of story; they are not evidence of real audience performance.">
          <div className="space-y-3">
            {BUILT_IN_REFERENCES.map((r) => (
              <div key={r.id} className="rounded-xl border bg-card p-4">
                <div className="font-medium">{r.title}</div>
                <div className="mt-1.5">
                  <Meta items={[r.archetype, r.hookStyle, r.endingType, r.tone]} />
                </div>
                <p className="mt-2 text-xs text-muted-foreground">Shape: {r.structure}</p>
                <details className="mt-2 text-sm">
                  <summary className="cursor-pointer text-xs text-muted-foreground">Script</summary>
                  <p className="mt-1">{r.text}</p>
                </details>
              </div>
            ))}
          </div>
        </Section>
      </div>
    </>
  );
}
