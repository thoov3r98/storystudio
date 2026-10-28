import { CheckCircle2, Circle } from "lucide-react";
import { integrationStatus } from "@/lib/env";

/** Shows which integrations still need configuration. Hidden once everything is set. */
export function SetupChecklist() {
  const s = integrationStatus();
  const items = [
    { ok: s.database, label: "Neon database", env: "DATABASE_URL" },
    { ok: s.openai, label: "OpenAI (writing + illustrations)", env: "OPENAI_API_KEY" },
    { ok: s.elevenlabs, label: "ElevenLabs (narration)", env: "ELEVENLABS_API_KEY" },
    { ok: s.blob, label: "Vercel Blob (asset storage)", env: "BLOB_READ_WRITE_TOKEN" },
    { ok: s.trigger, label: "Trigger.dev (background jobs)", env: "TRIGGER_SECRET_KEY" },
    { ok: s.render, label: s.renderProvider === "local" ? "Local rendering" : "Vercel Sandbox rendering", env: "RENDER_API_SECRET + STUDIO_APP_URL" },
  ];
  if (items.every((i) => i.ok)) return null;
  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-4">
      <p className="text-sm font-medium">Finish setup to run the production pipeline</p>
      <p className="mt-0.5 text-xs text-muted-foreground">Set these environment variables (see README). Nothing below is simulated — unconfigured steps fail with a clear error.</p>
      <ul className="mt-3 grid gap-1.5 sm:grid-cols-2">
        {items.map((i) => (
          <li key={i.label} className="flex items-center gap-2 text-sm">
            {i.ok ? <CheckCircle2 className="size-4 text-success" /> : <Circle className="size-4 text-muted-foreground" />}
            <span className={i.ok ? "text-muted-foreground" : ""}>{i.label}</span>
            {!i.ok ? <code className="ml-auto rounded bg-background px-1.5 py-0.5 text-[11px] text-muted-foreground">{i.env}</code> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
