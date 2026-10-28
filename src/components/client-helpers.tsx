"use client";

import { useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import type { ActionResult } from "@/app/actions";

/** Re-fetches server data on an interval while something is in progress. */
export function AutoRefresh({ active, intervalMs = 4000 }: { active: boolean; intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(id);
  }, [active, intervalMs, router]);
  return null;
}

export function useAction() {
  const [pending, start] = useTransition();
  const run = <T,>(fn: () => Promise<ActionResult<T>>, messages?: { success?: string; onSuccess?: (data?: T) => void }) =>
    start(async () => {
      const result = await fn();
      if (result.ok) {
        if (messages?.success) toast.success(messages.success);
        messages?.onSuccess?.(result.data);
      } else {
        toast.error(result.error);
      }
    });
  return { pending, run };
}

type ButtonProps = React.ComponentProps<typeof Button>;

export function ActionButton<T>({
  action,
  success,
  confirm,
  children,
  onSuccess,
  ...props
}: Omit<ButtonProps, "onClick" | "action"> & {
  action: () => Promise<ActionResult<T>>;
  success?: string;
  onSuccess?: (data?: T) => void;
  confirm?: { title: string; description: string; confirmLabel?: string };
}) {
  const { pending, run } = useAction();
  const button = (
    <Button {...props} disabled={pending || props.disabled} onClick={confirm ? undefined : () => run(action, { success, onSuccess })}>
      {pending ? <Loader2 className="animate-spin" /> : null}
      {children}
    </Button>
  );
  if (!confirm) return button;
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>{button}</AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{confirm.title}</AlertDialogTitle>
          <AlertDialogDescription>{confirm.description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={() => run(action, { success, onSuccess })}>{confirm.confirmLabel ?? "Continue"}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
