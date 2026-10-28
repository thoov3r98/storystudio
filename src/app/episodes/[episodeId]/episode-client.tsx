"use client";

import { useState } from "react";
import { Loader2, PenLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ActionButton, useAction } from "@/components/client-helpers";
import { restoreVersion, runEpisodeAction, setPrimaryHook, selectSceneImage } from "@/app/actions";
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

export function HookActions({ episodeId, hookId, hasScript, disabled }: { episodeId: string; hookId: string; hasScript: boolean; disabled?: boolean }) {
  if (!hasScript) {
    return (
      <div className="mt-3">
        <ActionButton size="xs" variant="outline" disabled={disabled} action={() => setPrimaryHook(episodeId, hookId)} success="Hook selected">
          Use this hook
        </ActionButton>
      </div>
    );
  }
  return (
    <div className="mt-3">
      <ActionButton
        size="xs"
        variant="outline"
        disabled={disabled}
        action={() => runEpisodeAction(episodeId, { action: "swap-hook", hookId }, true)}
        success="Swapping hook"
        confirm={{
          title: "Use this hook?",
          description:
            "Creates a new script version with this opening. Scene images are kept; the narration is re-recorded, re-synchronised and the video re-rendered. If the opening can't be swapped in place, the script is rewritten around the new hook.",
          confirmLabel: "Swap hook",
        }}
      >
        Use this hook
      </ActionButton>
    </div>
  );
}

export function RewriteSceneDialog({ episodeId, sceneNumber, disabled }: { episodeId: string; sceneNumber: number; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [cont, setCont] = useState(true);
  const { pending, run } = useAction();
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="xs" variant="outline" disabled={disabled}>
          <PenLine /> Rewrite narration
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rewrite scene {sceneNumber}</DialogTitle>
          <DialogDescription>
            Creates a new script version. The voiceover, timing and captions are regenerated; this scene’s image is regenerated only if its visual changes.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor={`ins-${sceneNumber}`}>Instruction (optional)</Label>
          <Textarea id={`ins-${sceneNumber}`} rows={3} value={instruction} onChange={(e) => setInstruction(e.target.value)} placeholder="e.g. Make this beat more tense and remove the statistic" />
        </div>
        <div className="flex items-center justify-between rounded-lg border p-3">
          <Label htmlFor={`cont-${sceneNumber}`} className="text-sm font-normal">
            Continue to a new MP4 afterwards
          </Label>
          <Switch id={`cont-${sceneNumber}`} checked={cont} onCheckedChange={setCont} />
        </div>
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
