"use client";

import { createContext, useContext, useState } from "react";
import { Archive, ArchiveRestore, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useAction } from "@/components/client-helpers";
import { setArchivedMany } from "@/app/actions";
import { cn } from "@/lib/utils";

type Selection = { selected: Set<string>; toggle: (id: string) => void };

const SelectionContext = createContext<Selection | null>(null);

/** Multi-select for the story library, with a bar to archive (or unarchive) the selection. */
export function LibrarySelection({ ids, archivedView, children }: { ids: string[]; archivedView: boolean; children: React.ReactNode }) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const { pending, run } = useAction();
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  // Ignore ids that left the list (e.g. after a filter change).
  const chosen = ids.filter((id) => selected.has(id));
  const n = chosen.length;

  return (
    <SelectionContext.Provider value={{ selected, toggle }}>
      {children}
      {n > 0 ? (
        <div className="fixed inset-x-4 bottom-4 z-40 mx-auto flex max-w-2xl flex-wrap items-center gap-2 rounded-xl border bg-card p-3 shadow-lg" role="region" aria-label="Selected stories">
          <span className="text-sm font-medium tabular-nums">
            {n} selected
          </span>
          {n < ids.length ? (
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set(ids))}>
              Select all {ids.length}
            </Button>
          ) : null}
          <div className="ml-auto flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              <X /> Clear
            </Button>
            <Button
              size="sm"
              disabled={pending}
              onClick={() =>
                run(() => setArchivedMany(chosen, !archivedView), {
                  success: `${archivedView ? "Unarchived" : "Archived"} ${n} ${n === 1 ? "story" : "stories"}`,
                  onSuccess: () => setSelected(new Set()),
                })
              }
            >
              {pending ? <Loader2 className="animate-spin" /> : archivedView ? <ArchiveRestore /> : <Archive />}
              {archivedView ? "Unarchive" : "Archive"}
            </Button>
          </div>
        </div>
      ) : null}
    </SelectionContext.Provider>
  );
}

/** Wraps a story card. While anything is selected, clicking the card toggles it instead of opening it. */
export function SelectableStory({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  const ctx = useContext(SelectionContext);
  if (!ctx) return children;
  const checked = ctx.selected.has(id);
  const selecting = ctx.selected.size > 0;
  return (
    <div
      className={cn("group/select relative rounded-xl", checked && "ring-2 ring-primary")}
      onClickCapture={(e) => {
        if (!selecting) return;
        e.preventDefault();
        e.stopPropagation();
        ctx.toggle(id);
      }}
    >
      {children}
      <div
        className={cn(
          "absolute top-2 right-2 flex size-8 items-center justify-center rounded-lg bg-card/90 transition-opacity",
          // Always visible on touch screens and while selecting; on hover otherwise.
          checked || selecting ? "opacity-100" : "opacity-100 md:opacity-0 md:group-hover/select:opacity-100 md:focus-within:opacity-100",
        )}
        onClickCapture={(e) => {
          e.preventDefault();
          e.stopPropagation();
          ctx.toggle(id);
        }}
      >
        <Checkbox checked={checked} aria-label={`Select ${title}`} className="size-5" />
      </div>
    </div>
  );
}
