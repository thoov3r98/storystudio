import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { JOB_STATUS_LABELS, STORY_STATUS_LABELS } from "@/lib/constants";
import type { EpisodeStatus, FactCheckStatus, JobStatus, StoryStatus } from "@/generated/prisma/enums";
import { formatUsd } from "@/lib/costs/estimate";

export function PageHeader({ title, description, actions, eyebrow }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; eyebrow?: React.ReactNode }) {
  return (
    <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow ? <div className="mb-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">{eyebrow}</div> : null}
        <h1 className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl">{title}</h1>
        {description ? <p className="mt-1.5 max-w-2xl text-sm text-muted-foreground text-pretty">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function Section({ title, description, actions, children, className }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("space-y-3", className)}>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold tracking-tight">{title}</h2>
          {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {actions}
      </div>
      {children}
    </section>
  );
}

export function StatCard({ label, value, icon: Icon, hint, tone = "default" }: { label: string; value: React.ReactNode; icon?: LucideIcon; hint?: string; tone?: "default" | "warning" | "danger" | "success" }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
        {label}
        {Icon ? (
          <Icon
            className={cn(
              "size-4",
              tone === "danger" && "text-destructive",
              tone === "warning" && "text-warning",
              tone === "success" && "text-success",
            )}
          />
        ) : null}
      </div>
      <div className="mt-2 text-2xl font-semibold tabular-nums tracking-tight">{value}</div>
      {hint ? <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div> : null}
    </div>
  );
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed bg-card/50 px-6 py-14 text-center">
      <svg viewBox="0 0 64 64" className="mb-4 size-14 text-muted-foreground/60" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <circle cx="32" cy="14" r="6" />
        <path d="M32 20v20M32 40l-8 14M32 40l8 14M32 27l-10 6M32 27l9-8" />
        <path d="M45 13l3-3M48 18h4M44 8V4" />
      </svg>
      <p className="font-medium">{title}</p>
      {description ? <p className="mt-1 max-w-sm text-sm text-muted-foreground text-pretty">{description}</p> : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

const storyTone: Record<StoryStatus, string> = {
  CONCEPT: "bg-secondary text-secondary-foreground",
  IN_PRODUCTION: "bg-blue-50 text-blue-800 border-blue-200",
  READY: "bg-emerald-50 text-emerald-800 border-emerald-200",
  PUBLISHED: "bg-primary text-primary-foreground",
  CONTINUING: "bg-violet-50 text-violet-800 border-violet-200",
  ARCHIVED: "bg-muted text-muted-foreground",
};

export function StoryStatusBadge({ status }: { status: StoryStatus }) {
  return (
    <Badge variant="outline" className={cn("border", storyTone[status])}>
      {STORY_STATUS_LABELS[status]}
    </Badge>
  );
}

const episodeLabels: Record<EpisodeStatus, string> = {
  DRAFT: "Concept",
  SCRIPTED: "Scripted",
  IN_PRODUCTION: "In production",
  READY: "Ready for review",
  APPROVED: "Approved",
  PUBLISHED: "Published",
  FAILED: "Failed",
};
const episodeTone: Record<EpisodeStatus, string> = {
  DRAFT: "bg-secondary text-secondary-foreground",
  SCRIPTED: "bg-amber-50 text-amber-800 border-amber-200",
  IN_PRODUCTION: "bg-blue-50 text-blue-800 border-blue-200",
  READY: "bg-emerald-50 text-emerald-800 border-emerald-200",
  APPROVED: "bg-emerald-600 text-white border-emerald-600",
  PUBLISHED: "bg-primary text-primary-foreground",
  FAILED: "bg-red-50 text-red-700 border-red-200",
};

export function EpisodeStatusBadge({ status }: { status: EpisodeStatus }) {
  return (
    <Badge variant="outline" className={cn("border", episodeTone[status])}>
      {episodeLabels[status]}
    </Badge>
  );
}

export function JobStatusBadge({ status }: { status: JobStatus }) {
  const tone =
    status === "COMPLETED"
      ? "bg-emerald-50 text-emerald-800 border-emerald-200"
      : status === "FAILED"
        ? "bg-red-50 text-red-700 border-red-200"
        : status === "CANCELED"
          ? "bg-muted text-muted-foreground"
          : status === "QUEUED"
            ? "bg-secondary text-secondary-foreground"
            : "bg-blue-50 text-blue-800 border-blue-200";
  const running = !["COMPLETED", "FAILED", "CANCELED", "QUEUED"].includes(status);
  return (
    <Badge variant="outline" className={cn("border", tone)}>
      {running ? <span className="size-1.5 animate-pulse rounded-full bg-current" /> : null}
      {JOB_STATUS_LABELS[status]}
    </Badge>
  );
}

export function FactBadge({ status }: { status: FactCheckStatus }) {
  const map: Record<FactCheckStatus, [string, string]> = {
    PENDING: ["Fact review pending", "bg-secondary text-secondary-foreground"],
    PASSED: ["Facts reviewed", "bg-emerald-50 text-emerald-800 border-emerald-200"],
    NEEDS_REVIEW: ["Claims need review", "bg-amber-50 text-amber-800 border-amber-200"],
    MANUALLY_APPROVED: ["Facts approved by you", "bg-emerald-50 text-emerald-800 border-emerald-200"],
  };
  const [label, tone] = map[status];
  return (
    <Badge variant="outline" className={cn("border", tone)}>
      {label}
    </Badge>
  );
}

export function Money({ value, estimate = true, className }: { value: number; estimate?: boolean; className?: string }) {
  return (
    <span className={cn("tabular-nums", className)} title={estimate ? "Estimated from configured provider pricing" : undefined}>
      {estimate ? "≈ " : ""}
      {formatUsd(value)}
    </span>
  );
}

export function TextLink({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) {
  return (
    <Link href={href} className={cn("font-medium text-foreground underline-offset-4 hover:underline", className)}>
      {children}
    </Link>
  );
}

export function PageSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-9 w-72" />
      <Skeleton className="h-4 w-96 max-w-full" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-32" />
        ))}
      </div>
    </div>
  );
}

export function Thumb({ src, alt, className }: { src: string | null | undefined; alt: string; className?: string }) {
  return (
    <div className={cn("relative overflow-hidden rounded-lg border bg-[#FAFAF7]", className)}>
      {src ? (
        // Blob images are already sized by the generator; plain img keeps this cheap and avoids optimizer config.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={alt} className="h-full w-full object-cover" loading="lazy" />
      ) : (
        <div className="grid h-full w-full place-items-center text-muted-foreground/50">
          <svg viewBox="0 0 48 48" className="size-10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="24" cy="12" r="5" />
            <path d="M24 17v14M24 31l-6 10M24 31l6 10M24 22l-8 4M24 22l8 4" />
          </svg>
        </div>
      )}
    </div>
  );
}

export function relativeTime(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}d ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
