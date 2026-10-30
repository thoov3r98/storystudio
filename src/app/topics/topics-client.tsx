"use client";

import { useState } from "react";
import Link from "next/link";
import { Check, Download, Library, Loader2, PenLine, Plus, Sparkles, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ActionButton, useAction } from "@/components/client-helpers";
import {
  addMetricAction,
  addStarterReferencesAction,
  createReferenceAction,
  deleteReferenceAction,
  discoverTopicsAction,
  importReferenceAction,
  makeVideoFromTopic,
  previewVideoMetadata,
  setTopicStatus,
  updateReferenceAction,
} from "@/app/actions";
import { PLATFORMS, type Platform } from "@/lib/schemas/topics";

type RefForm = {
  platform: Platform;
  creator: string;
  url: string;
  title: string;
  product: string;
  category: string;
  publishedAt: string;
  durationSec: string;
  notableStep: string;
  curiosityMechanism: string;
  observedHook: string;
  transformationType: string;
  notes: string;
  usageRights: string;
};

type MetricForm = { views: string; likes: string; comments: string; shares: string; observedAt: string; note: string };

const today = () => new Date().toISOString().slice(0, 10);
const EMPTY: RefForm = {
  platform: "youtube",
  creator: "",
  url: "",
  title: "",
  product: "",
  category: "",
  publishedAt: "",
  durationSec: "",
  notableStep: "",
  curiosityMechanism: "",
  observedHook: "",
  transformationType: "",
  notes: "",
  usageRights: "Reference only; not licensed for reuse",
};
const EMPTY_METRICS: MetricForm = { views: "", likes: "", comments: "", shares: "", observedAt: today(), note: "" };
const hasNumbers = (m: MetricForm) => [m.views, m.likes, m.comments, m.shares].some((x) => x.trim() !== "");

function Field({ label, children, hint, wide }: { label: string; children: React.ReactNode; hint?: string; wide?: boolean }) {
  return (
    <div className={wide ? "space-y-1.5 sm:col-span-2" : "space-y-1.5"}>
      <Label>{label}</Label>
      {children}
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

function MetricFields({ m, set }: { m: MetricForm; set: (m: MetricForm) => void }) {
  const num = (k: keyof MetricForm, label: string) => (
    <Field label={label}>
      <Input inputMode="numeric" value={m[k]} onChange={(e) => set({ ...m, [k]: e.target.value.replace(/[^\d]/g, "") })} placeholder="unknown" />
    </Field>
  );
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {num("views", "Views")}
      {num("likes", "Likes")}
      {num("comments", "Comments")}
      {num("shares", "Shares")}
      <Field label="Seen on" hint="The date you saw these numbers.">
        <Input type="date" value={m.observedAt} max={today()} onChange={(e) => set({ ...m, observedAt: e.target.value })} />
      </Field>
      <Field label="Note">
        <Input value={m.note} onChange={(e) => set({ ...m, note: e.target.value })} placeholder="optional" />
      </Field>
    </div>
  );
}

export type SavedReference = Omit<RefForm, "durationSec" | "url" | "platform"> & { id: string; platform: string; durationSec: number | null; url: string | null };

/** Add a reference (no `reference`) or edit one. */
export function ReferenceDialog({ reference }: { reference?: SavedReference }) {
  const [open, setOpen] = useState(false);
  const initial: RefForm = reference ? { ...reference, platform: reference.platform as Platform, url: reference.url ?? "", durationSec: reference.durationSec?.toString() ?? "" } : EMPTY;
  const [f, setF] = useState<RefForm>(initial);
  const [m, setM] = useState<MetricForm>(EMPTY_METRICS);
  const [fetched, setFetched] = useState<string | null>(null);
  const a = useAction();
  const lookup = useAction();
  const set = (k: keyof RefForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });

  const fill = () =>
    lookup.run(() => previewVideoMetadata(f.url), {
      onSuccess: (meta) => {
        if (!meta) return setFetched("No supported way to read this link. Fill the details in by hand.");
        setF((x) => ({ ...x, platform: meta.platform, title: meta.title ?? x.title, creator: meta.creator ?? x.creator, publishedAt: meta.publishedAt?.slice(0, 10) ?? x.publishedAt, durationSec: meta.durationSec?.toString() ?? x.durationSec }));
        setFetched(`Filled from ${meta.method}.${meta.metrics ? " Verified numbers will be stored when you save." : " Numbers aren't available from this source; enter what you see, with the date."}`);
      },
    });

  const save = () => {
    const input = { ...f, durationSec: f.durationSec || null, publishedAt: f.publishedAt || null, url: f.url || null };
    a.run(
      async () => {
        if (reference) return updateReferenceAction(reference.id, input);
        const created = await createReferenceAction(input, hasNumbers(m) ? m : null);
        // A link the platform can read is confirmed (and, with an API key, gets verified numbers).
        if (created.ok && created.data && input.url && fetched?.startsWith("Filled")) await importReferenceAction(created.data.id);
        return created;
      },
      {
        success: reference ? "Reference updated" : "Reference added",
        onSuccess: () => {
          setOpen(false);
          if (!reference) {
            setF(EMPTY);
            setM(EMPTY_METRICS);
            setFetched(null);
          }
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {reference ? (
          <Button size="xs" variant="ghost" aria-label="Edit">
            <PenLine />
          </Button>
        ) : (
          <Button size="sm">
            <Plus /> Add reference
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{reference ? "Edit reference" : "Add a successful manufacturing video"}</DialogTitle>
          <DialogDescription>Only enter what you actually saw. Blank numbers stay unknown; they are never filled in for you.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Video URL" wide hint="YouTube and TikTok links can fill in the title and creator from the platform.">
            <div className="flex gap-2">
              <Input value={f.url} onChange={set("url")} placeholder="https://" />
              <Button type="button" variant="outline" size="sm" disabled={!f.url.trim() || lookup.pending} onClick={fill}>
                {lookup.pending ? <Loader2 className="animate-spin" /> : <Download />} Fill from link
              </Button>
            </div>
            {fetched ? <p className="text-xs text-muted-foreground">{fetched}</p> : null}
          </Field>
          <Field label="Platform">
            <select value={f.platform} onChange={set("platform")} className="h-9 w-full rounded-md border bg-background px-2 text-sm">
              {PLATFORMS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Creator or channel">
            <Input value={f.creator} onChange={set("creator")} />
          </Field>
          <Field label="Title" wide>
            <Input value={f.title} onChange={set("title")} />
          </Field>
          <Field label="Product made">
            <Input value={f.product} onChange={set("product")} placeholder="e.g. Razor blades" />
          </Field>
          <Field label="Category">
            <Input value={f.category} onChange={set("category")} placeholder="e.g. personal care" />
          </Field>
          <Field label="Published">
            <Input type="date" value={f.publishedAt} onChange={set("publishedAt")} />
          </Field>
          <Field label="Length (seconds)">
            <Input inputMode="numeric" value={f.durationSec} onChange={(e) => setF({ ...f, durationSec: e.target.value.replace(/[^\d]/g, "") })} />
          </Field>
          <Field label="Notable manufacturing step" wide>
            <Input value={f.notableStep} onChange={set("notableStep")} placeholder="The moment that makes it worth watching" />
          </Field>
          <Field label="Curiosity mechanism" wide>
            <Input value={f.curiosityMechanism} onChange={set("curiosityMechanism")} placeholder="e.g. scrap steel becomes a knife" />
          </Field>
          <Field label="Opening, as observed" wide hint="Only if you watched it.">
            <Input value={f.observedHook} onChange={set("observedHook")} />
          </Field>
          <Field label="Operation type">
            <Input value={f.transformationType} onChange={set("transformationType")} placeholder="molding, forging, recycling…" />
          </Field>
          <Field label="Usage rights">
            <Input value={f.usageRights} onChange={set("usageRights")} />
          </Field>
          <Field label="Notes" wide>
            <Textarea rows={2} value={f.notes} onChange={set("notes")} />
          </Field>
        </div>
        {!reference ? (
          <details className="rounded-lg border p-3">
            <summary className="cursor-pointer text-sm font-medium">Audience numbers you saw (optional)</summary>
            <div className="mt-3">
              <MetricFields m={m} set={setM} />
            </div>
          </details>
        ) : null}
        <DialogFooter>
          <Button onClick={save} disabled={a.pending || !f.title.trim() || !f.product.trim() || !f.category.trim() || !f.creator.trim()}>
            {a.pending ? <Loader2 className="animate-spin" /> : <Check />} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function MetricDialog({ referenceId, title }: { referenceId: string; title: string }) {
  const [open, setOpen] = useState(false);
  const [m, setM] = useState<MetricForm>(EMPTY_METRICS);
  const a = useAction();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="xs" variant="outline">
          <Plus /> Record numbers
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record numbers</DialogTitle>
          <DialogDescription>
            What you saw on “{title}”, and when. Stored as unverified. Leave anything you didn&apos;t see blank.
          </DialogDescription>
        </DialogHeader>
        <MetricFields m={m} set={setM} />
        <DialogFooter>
          <Button
            disabled={a.pending || !hasNumbers(m)}
            onClick={() =>
              a.run(() => addMetricAction(referenceId, m), {
                success: "Recorded",
                onSuccess: () => {
                  setOpen(false);
                  setM(EMPTY_METRICS);
                },
              })
            }
          >
            {a.pending ? <Loader2 className="animate-spin" /> : <Check />} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ReferenceActions({ reference }: { reference: SavedReference }) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      {reference.url ? (
        <ActionButton size="xs" variant="ghost" aria-label="Import details from the platform" title="Import details from the platform" action={() => importReferenceAction(reference.id)} success="Details imported">
          <Download />
        </ActionButton>
      ) : null}
      <ReferenceDialog reference={reference} />
      <ActionButton
        size="xs"
        variant="ghost"
        aria-label="Delete"
        action={() => deleteReferenceAction(reference.id)}
        success="Deleted"
        confirm={{ title: "Delete this reference?", description: "Its numbers are deleted too, and topics proposed from it lose this evidence.", confirmLabel: "Delete" }}
      >
        <Trash2 />
      </ActionButton>
    </div>
  );
}

export function StarterButton() {
  return (
    <ActionButton
      size="sm"
      variant="outline"
      action={addStarterReferencesAction}
      success="Starter references added"
      confirm={{
        title: "Add the starter references?",
        description: "Five curated manufacturing videos. Only sources that could be confirmed have a link; none come with view counts. Record the numbers you see, with the date.",
        confirmLabel: "Add them",
      }}
    >
      <Library /> Add starter references
    </ActionButton>
  );
}

export function DiscoverButton({ channels, disabled }: { channels: { id: string; name: string }[]; disabled: boolean }) {
  const [channelId, setChannelId] = useState(channels[0]?.id ?? "");
  if (!channels.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {channels.length > 1 ? (
        <select value={channelId} onChange={(e) => setChannelId(e.target.value)} className="h-8 rounded-md border bg-background px-2 text-sm" aria-label="Channel">
          {channels.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      ) : null}
      <ActionButton
        size="sm"
        disabled={disabled || !channelId}
        action={() => discoverTopicsAction(channelId)}
        success="Generating topics"
        confirm={{ title: "Generate related topics?", description: "Two model calls propose and rate about nine products from the library (a few cents). Products rated in the last 30 days reuse their ratings.", confirmLabel: "Generate" }}
      >
        <Sparkles /> Generate topics
      </ActionButton>
    </div>
  );
}

export function TopicActions({ id, title, status, storyId }: { id: string; title: string; status: string; storyId: string | null }) {
  if (storyId) {
    return (
      <Link href={`/stories/${storyId}`} className="text-sm font-medium underline-offset-4 hover:underline">
        Open story →
      </Link>
    );
  }
  return (
    <div className="flex flex-wrap gap-2">
      {status === "APPROVED" ? (
        <ActionButton
          size="sm"
          action={() => makeVideoFromTopic(id)}
          confirm={{ title: `Make “${title}”?`, description: "Researches the real process, writes and checks every part's script, then stops for your review. Nothing is spent on media until you approve a script.", confirmLabel: "Make it" }}
        >
          <PenLine /> Make this video
        </ActionButton>
      ) : status === "PROPOSED" ? (
        <ActionButton size="sm" variant="outline" action={() => setTopicStatus(id, "APPROVED")} success="Approved">
          <Check /> Approve
        </ActionButton>
      ) : null}
      {status === "REJECTED" ? (
        <ActionButton size="sm" variant="ghost" action={() => setTopicStatus(id, "PROPOSED")}>
          Undo
        </ActionButton>
      ) : status !== "USED" ? (
        <ActionButton size="sm" variant="ghost" action={() => setTopicStatus(id, "REJECTED")}>
          <X /> Reject
        </ActionButton>
      ) : null}
    </div>
  );
}
