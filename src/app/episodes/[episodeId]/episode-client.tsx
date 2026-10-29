"use client";

import { useState } from "react";
import { Loader2, PenLine, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ActionButton, useAction } from "@/components/client-helpers";
import { dismissScriptIssue, rateScript, restoreVersion, runEpisodeAction, selectSceneImage } from "@/app/actions";
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

export function RewriteSceneDialog({
  episodeId,
  sceneNumber,
  disabled,
  opening,
  produced,
}: {
  episodeId: string;
  sceneNumber: number;
  disabled?: boolean;
  opening?: boolean;
  /** The video has been made before; otherwise the script is still under review and the rewrite stops there. */
  produced?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [cont, setCont] = useState(Boolean(produced));
  const { pending, run } = useAction();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="xs" variant="outline" disabled={disabled}>
          <PenLine /> {opening ? "Rewrite opening" : "Rewrite narration"}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{opening ? "Rewrite the opening" : `Rewrite scene ${sceneNumber}`}</DialogTitle>
          <DialogDescription>
            {produced
              ? "Creates a new script version and fact-checks it again. The voiceover, timing and captions are regenerated; this scene’s image is regenerated only if its visual changes."
              : "Creates a new script version and fact-checks it again. Nothing is spent on media until you approve the script."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor={`ins-${sceneNumber}`}>Instruction (optional)</Label>
          <Textarea id={`ins-${sceneNumber}`} rows={3} value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder={opening ? "e.g. Start in the moment the chair stops, and make it funnier" : "e.g. Make this beat more tense and remove the statistic"} />
        </div>
        {produced ? (
          <div className="flex items-center justify-between rounded-lg border p-3">
            <Label htmlFor={`cont-${sceneNumber}`} className="text-sm font-normal">
              Also make a new MP4 afterwards (if the checks pass)
            </Label>
            <Switch id={`cont-${sceneNumber}`} checked={cont} onCheckedChange={setCont} />
          </div>
        ) : null}
        <DialogFooter>
          <Button
            disabled={pending}
            onClick={() =>
              run(() => runEpisodeAction(episodeId, { action: "rewrite-scene", sceneNumber, instruction: instruction.trim() || null }, cont), {
                success: "Rewrite queued",
                onSuccess: () => setOpen(false),
              })
            }
          >
            {pending ? <Loader2 className="animate-spin" /> : null} Rewrite
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

/** Dismisses a flagged issue the producer judges to be wrong; it is recorded as a false positive. */
export function DismissIssueButton({ versionId, issueId }: { versionId: string; issueId: string }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const { pending, run } = useAction();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="xs" variant="ghost">
          Not a problem
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Dismiss this issue?</DialogTitle>
          <DialogDescription>Use this when the checker is wrong. It is recorded as a false positive, and the script&apos;s status is re-evaluated.</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor={`dismiss-${issueId}`}>Why it&apos;s fine (optional)</Label>
          <Textarea id={`dismiss-${issueId}`} rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. It's explained in scene 3" />
        </div>
        <DialogFooter>
          <Button
            disabled={pending}
            onClick={() => run(() => dismissScriptIssue(versionId, issueId, note.trim()), { success: "Issue dismissed", onSuccess: () => setOpen(false) })}
          >
            {pending ? <Loader2 className="animate-spin" /> : null} Dismiss issue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ScriptRating({ versionId, rating }: { versionId: string; rating: number | null }) {
  const { pending, run } = useAction();
  return (
    <div className="flex items-center gap-0.5" role="group" aria-label="Your rating">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          aria-label={`${n} star${n === 1 ? "" : "s"}`}
          aria-pressed={rating === n}
          disabled={pending}
          onClick={() => run(() => rateScript(versionId, rating === n ? null : n))}
          className="rounded p-0.5 text-amber-500 hover:bg-muted disabled:opacity-50"
        >
          <Star className={cn("size-5", rating !== null && n <= rating ? "fill-current" : "")} />
        </button>
      ))}
    </div>
  );
}
