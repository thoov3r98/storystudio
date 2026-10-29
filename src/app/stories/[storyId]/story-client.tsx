"use client";

import { useState } from "react";
import { Archive, ArchiveRestore, BarChart3, CheckCircle2, Loader2, Pencil, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ActionButton, useAction } from "@/components/client-helpers";
import { addMetrics, approveEpisodeAction, markPublished, setArchived, updateStoryTitle } from "@/app/actions";

export function StoryHeaderActions({ storyId, title, archived }: { storyId: string; title: string; archived: boolean }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(title);
  const { pending, run } = useAction();
  return (
    <>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button variant="outline">
            <Pencil /> Rename
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit story title</DialogTitle>
          </DialogHeader>
          <Input value={value} onChange={(e) => setValue(e.target.value)} maxLength={200} />
          <DialogFooter>
            <Button disabled={pending || value.trim().length < 3} onClick={() => run(() => updateStoryTitle(storyId, value), { success: "Title updated", onSuccess: () => setOpen(false) })}>
              {pending ? <Loader2 className="animate-spin" /> : null} Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <ActionButton
        variant="outline"
        action={() => setArchived(storyId, !archived)}
        success={archived ? "Story restored" : "Story archived"}
        confirm={
          archived
            ? undefined
            : { title: "Archive this story?", description: "It stays in your library under Archived with all episodes and assets. You can restore it anytime.", confirmLabel: "Archive" }
        }
      >
        {archived ? <ArchiveRestore /> : <Archive />} {archived ? "Unarchive" : "Archive"}
      </ActionButton>
    </>
  );
}

export function ApproveEpisodeButton({ episodeId }: { episodeId: string }) {
  const [open, setOpen] = useState(false);
  const { pending, run } = useAction();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <CheckCircle2 /> Approve
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Approve this episode?</DialogTitle>
          <DialogDescription>
            Approval locks this script version. Later edits create a new version.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="gap-2">
          <Button disabled={pending} onClick={() => run(() => approveEpisodeAction(episodeId), { success: "Episode approved", onSuccess: () => setOpen(false) })}>
            {pending ? <Loader2 className="animate-spin" /> : null} Approve
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PublishDialog({ episodeId, published }: { episodeId: string; published: boolean }) {
  const [open, setOpen] = useState(false);
  const [platform, setPlatform] = useState("TikTok");
  const [url, setUrl] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const { pending, run } = useAction();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <Send /> {published ? "Edit publish info" : "Mark published"}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Mark as manually published</DialogTitle>
          <DialogDescription>The studio never posts anywhere. Record where you published it so you can track performance.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Platform</Label>
            <Input value={platform} onChange={(e) => setPlatform(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Date</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Post URL (optional)</Label>
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" />
          </div>
        </div>
        <DialogFooter>
          <Button disabled={pending} onClick={() => run(() => markPublished(episodeId, { platform, url, publishedAt: date }), { success: "Saved", onSuccess: () => setOpen(false) })}>
            {pending ? <Loader2 className="animate-spin" /> : null} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const METRIC_FIELDS = [
  ["views", "Views"],
  ["likes", "Likes"],
  ["comments", "Comments"],
  ["shares", "Shares"],
  ["saves", "Saves"],
  ["followersGained", "Followers gained"],
  ["avgWatchTimeSec", "Avg. watch time (s)"],
  ["earlyRetention", "Still watching after 3s (%)"],
  ["completionRate", "Completion rate (%)"],
  ["rewatchRate", "Rewatches (% of views)"],
] as const;

export function MetricsDialog({ episodeId }: { episodeId: string }) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({ platform: "TikTok" });
  const { pending, run } = useAction();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          <BarChart3 /> Enter metrics
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record performance</DialogTitle>
          <DialogDescription>Entered manually from the platform’s analytics. Each entry is kept as a snapshot.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2 space-y-1.5">
            <Label>Platform</Label>
            <Input value={values.platform ?? ""} onChange={(e) => setValues((v) => ({ ...v, platform: e.target.value }))} />
          </div>
          {METRIC_FIELDS.map(([key, label]) => (
            <div key={key} className="space-y-1.5">
              <Label>{label}</Label>
              <Input type="number" inputMode="decimal" value={values[key] ?? ""} onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))} />
            </div>
          ))}
          <div className="col-span-2 space-y-1.5">
            <Label>Notes</Label>
            <Textarea rows={2} value={values.notes ?? ""} onChange={(e) => setValues((v) => ({ ...v, notes: e.target.value }))} />
          </div>
        </div>
        <DialogFooter>
          <Button
            disabled={pending}
            onClick={() =>
              run(() => addMetrics(episodeId, values as Parameters<typeof addMetrics>[1]), {
                success: "Metrics saved",
                onSuccess: () => {
                  setOpen(false);
                  setValues({ platform: values.platform });
                },
              })
            }
          >
            {pending ? <Loader2 className="animate-spin" /> : null} Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
