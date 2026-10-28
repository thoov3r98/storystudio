"use client";

import { RotateCcw, Square } from "lucide-react";
import { ActionButton } from "@/components/client-helpers";
import { cancelJobAction, retryJobAction } from "@/app/actions";

export function JobControls({ jobId, canCancel, canRetry }: { jobId: string; canCancel: boolean; canRetry: boolean }) {
  return (
    <div className="flex w-24 justify-end gap-1">
      {canCancel ? (
        <ActionButton
          size="sm"
          variant="outline"
          action={() => cancelJobAction(jobId)}
          success="Job canceled"
          confirm={{
            title: "Cancel this job?",
            description: "The run stops at its next checkpoint. Assets already generated are kept, and you can retry later to resume.",
            confirmLabel: "Cancel job",
          }}
        >
          <Square /> Cancel
        </ActionButton>
      ) : null}
      {canRetry ? (
        <ActionButton size="sm" variant="outline" action={() => retryJobAction(jobId)} success="Retry queued — completed stages will be skipped">
          <RotateCcw /> Retry
        </ActionButton>
      ) : null}
    </div>
  );
}
