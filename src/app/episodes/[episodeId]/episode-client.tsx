"use client";

import { useState } from "react";
import { Check, Copy, Loader2, PenLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ActionButton, useAction } from "@/components/client-helpers";
import { editHeadlineAction, editSceneAction, restoreVersion, runEpisodeAction, selectSceneImage, writePostCopyAction } from "@/app/actions";
import type { PostCopy } from "@/lib/schemas/episode";
import { cn } from "@/lib/utils";

type EpisodeRequest = Parameters<typeof runEpisodeAction>[1];

export function EpisodeActionButton({
  episodeId,
  request,
  label,
  disabled,
  size = "default",
  variant,
  primary,
  confirm,
  continueProduction = true,
}: {
  episodeId: string;
  request: EpisodeRequest;
  label: string;
  disabled?: boolean;
  size?: "default" | "sm" | "xs" | "lg";
  variant?: "default" | "outline" | "ghost" | "secondary";
  primary?: boolean;
  confirm?: string;
  continueProduction?: boolean;
}) {
  return (
    <ActionButton
      size={size}
      variant={variant ?? (primary ? "default" : "outline")}
      disabled={disabled}
      action={() => runEpisodeAction(episodeId, request, continueProduction)}
      success="Job queued"
      confirm={confirm ? { title: label, description: confirm, confirmLabel: label } : undefined}
    >
      {label}
    </ActionButton>
  );
}

/** The producer's own edit of a shot: its words and what its picture shows. Only what changed is made again. */
export function EditSceneDialog({
  episodeId,
  sceneNumber,
  narration,
  imagePrompt,
  disabled,
  note,
}: {
  episodeId: string;
  sceneNumber: number;
  narration: string;
  imagePrompt: string;
  disabled?: boolean;
  note?: string;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(narration);
  const [prompt, setPrompt] = useState(imagePrompt);
  const { pending, run } = useAction();
  const wordsChanged = text.replace(/\s+/g, " ").trim() !== narration;
  const pictureChanged = prompt.trim() !== imagePrompt;
  const redo = [wordsChanged ? "the voiceover and captions" : "", pictureChanged ? "this picture" : ""].filter(Boolean).join(" and ");
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          setText(narration);
          setPrompt(imagePrompt);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button size="xs" variant="outline" disabled={disabled}>
          <PenLine /> Edit shot
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit shot {sceneNumber}</DialogTitle>
          <DialogDescription>Saved as a new version, then a new MP4 is made. Only what you change is regenerated.{note}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor={`narr-${sceneNumber}`}>Narration</Label>
          <Textarea id={`narr-${sceneNumber}`} rows={4} value={text} onChange={(e) => setText(e.target.value)} />
        </div>
        <div className="space-y-2">
          <Label htmlFor={`prompt-${sceneNumber}`}>What the picture shows</Label>
          <Textarea id={`prompt-${sceneNumber}`} rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
          <p className="text-xs text-muted-foreground">Describe the subject only; the channel&apos;s art style is added automatically.</p>
        </div>
        <DialogFooter className="items-center gap-3 sm:justify-between">
          <p className="text-xs text-muted-foreground">{redo ? `Regenerates ${redo}.` : "Nothing changed yet."}</p>
          <Button
            disabled={pending || !redo}
            onClick={() =>
              run(() => editSceneAction(episodeId, sceneNumber, { narration: text, imagePrompt: prompt }), { success: "Saved; making the new video", onSuccess: () => setOpen(false) })
            }
          >
            {pending ? <Loader2 className="animate-spin" /> : null} Save and remake
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The video's title (on the title band) and the big on-screen text over its opening. */
export function EditHeadlineDialog({ episodeId, title, onScreenHook, disabled, note }: { episodeId: string; title: string; onScreenHook: string; disabled?: boolean; note?: string }) {
  const [open, setOpen] = useState(false);
  const [t, setT] = useState(title);
  const [hook, setHook] = useState(onScreenHook);
  const { pending, run } = useAction();
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          setT(title);
          setHook(onScreenHook);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" disabled={disabled}>
          <PenLine /> Edit title &amp; hook text
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Title and on-screen text</DialogTitle>
          <DialogDescription>A new MP4 is rendered with them. Pictures and voice are reused.{note}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="edit-title">Title</Label>
          <Input id="edit-title" value={t} onChange={(e) => setT(e.target.value)} maxLength={200} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="edit-hook">Big text over the opening</Label>
          <Input id="edit-hook" value={hook} onChange={(e) => setHook(e.target.value)} maxLength={80} placeholder="e.g. Crayons start as *hot liquid*" />
          <p className="text-xs text-muted-foreground">3–6 words read in a glance. Wrap a word in *asterisks* to highlight it. Leave empty for none.</p>
        </div>
        <DialogFooter>
          <Button
            disabled={pending || !t.trim()}
            onClick={() => run(() => editHeadlineAction(episodeId, { title: t, onScreenHook: hook }), { success: "Saved", onSuccess: () => setOpen(false) })}
          >
            {pending ? <Loader2 className="animate-spin" /> : null} Save and re-render
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function SceneImageHistory({
  episodeId,
  sceneNumber,
  currentImageId,
  images,
  disabled,
}: {
  episodeId: string;
  sceneNumber: number;
  currentImageId: string | null;
  images: { id: string; url: string; version: number }[];
  disabled?: boolean;
}) {
  const { pending, run } = useAction();
  if (images.length <= 1) return null;
  return (
    <div className="mt-2">
      <div className="mb-1 text-[11px] text-muted-foreground">Image history — click to restore</div>
      <div className="flex flex-wrap gap-1">
        {images.map((img) => (
          <button
            key={img.id}
            type="button"
            title={`Version ${img.version}`}
            disabled={pending || disabled || img.id === currentImageId}
            onClick={() => run(() => selectSceneImage(episodeId, sceneNumber, img.id), { success: `Restored image v${img.version}. Re-render to update the MP4.` })}
            className={cn("h-12 w-8 overflow-hidden rounded border", img.id === currentImageId ? "ring-2 ring-primary" : "opacity-70 hover:opacity-100")}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={img.url} alt="" className="h-full w-full object-cover" />
          </button>
        ))}
      </div>
    </div>
  );
}

export function VersionRestoreButton({ episodeId, versionId, disabled }: { episodeId: string; versionId: string; disabled?: boolean }) {
  return (
    <ActionButton
      size="xs"
      variant="ghost"
      disabled={disabled}
      action={() => restoreVersion(episodeId, versionId)}
      success="Version restored as a new draft"
      confirm={{ title: "Restore this version?", description: "It is copied into a new draft version and becomes current. Nothing is deleted.", confirmLabel: "Restore" }}
    >
      Restore
    </ActionButton>
  );
}

function CopyText({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</div>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2"
          onClick={() => {
            void navigator.clipboard.writeText(text).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          {copied ? <Check /> : <Copy />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <p className="whitespace-pre-wrap text-sm">{text}</p>
    </div>
  );
}

/** What to paste when posting: caption with hashtags, the cover, and a comment to pin. */
export function PostCopyPanel({ episodeId, copy, cover, disabled }: { episodeId: string; copy: PostCopy | null; cover: string | null; disabled?: boolean }) {
  return (
    <div className="space-y-3 rounded-xl border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-semibold">Post text</div>
        <ActionButton size="sm" variant="outline" disabled={disabled} action={() => writePostCopyAction(episodeId)} success="Post text written">
          {copy ? "Write again" : "Write post text"}
        </ActionButton>
      </div>
      {copy ? (
        <>
          <CopyText label="Caption" text={`${copy.caption}\n\n${copy.hashtags.join(" ")}`} />
          <div className="space-y-1">
            <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Cover</div>
            <div className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {cover ? <img src={cover} alt="" className="h-16 w-16 rounded-md border object-cover" /> : null}
              <p className="text-sm">
                Shot {copy.coverSceneNumber}, with “{copy.coverText}”
              </p>
            </div>
          </div>
          <CopyText label="Pinned comment" text={copy.pinnedComment} />
        </>
      ) : (
        <p className="text-sm text-muted-foreground">Written automatically after the video renders.</p>
      )}
    </div>
  );
}
