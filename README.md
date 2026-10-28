# The Invisible World Studio

A private studio for producing narrated, illustrated, serialized story videos (TikTok / Shorts / Reels). It pitches and scores opening-episode concepts, writes and fact-reviews scripts, illustrates scenes, records narration, renders 1080×1920 MP4s, and keeps a canonical story bible so any storyline can continue to Part 2, 3, 4 and beyond.

The studio never publishes anything. Its output is a downloadable MP4 plus every editable production asset.

---

## Contents

1. [How it works](#how-it-works)
2. [Local development](#local-development)
3. [Environment variables](#environment-variables)
4. [Production setup (step by step)](#production-setup)
5. [Security](#security)
6. [Testing](#testing)
7. [Operations and troubleshooting](#operations)
8. [Project layout](#project-layout)

---

## How it works

```
Generate page ──► Batch ──► Trigger.dev "ideate-batch"
                              │  pitch ~2N candidates (OpenAI, strict JSON)
                              │  dedupe vs library (title / trigram / keyword similarity)
                              │  score 9 editorial criteria, rank, keep top N
                              └► Story + Part 1 (DRAFT) + ≥3 scored hooks each

"Produce" / "Generate Next Episode" ──► Trigger.dev "episode-job"
   1. Write script (scenes, claims, proposed bible update)
   2. Fact review ─┐  bounded corrections (≤2 rounds)
   3. Continuity ──┘  (Part 2+; material conflicts stop before any media spend)
   4. Illustrate scenes (OpenAI Images, style references, per-scene retries)
   5. Narrate (ElevenLabs with character timestamps)
   6. Synchronize: scene boundaries + word-level captions from the real alignment
   7. Render: Vercel Sandbox (Remotion) → MP4 uploaded to Vercel Blob
```

Key design rules:

- **Every artifact is versioned and immutable.** Script versions, scene images, voiceovers and renders are separate rows; "current" pointers choose what is live. Approved versions are locked — any change forks a new draft version.
- **Minimal regeneration.** An image change replaces one image and re-renders. A voiceover change re-syncs and re-renders. A script change forks a version and invalidates voiceover, timing, captions and render (see `src/lib/invalidation.ts`).
- **Resumable jobs.** Each stage skips work whose artifact already exists, so retrying a failed job resumes rather than repaying for completed steps. A failed scene image never discards the others.
- **Continuity only becomes canon on approval.** Each script proposes a bible update; it's applied as a new bible version only when you approve the episode.
- **Selective memory for long series.** Continuations receive the canonical bible, the last ~10 approved episode summaries, and the latest episode in full. Older parts are represented by the bible's compressed arc summary.
- **No silent facts.** Every factual claim is classified and assessed. Anything not widely documented is flagged; episodes with open flags can't be approved until you verify, revise or reject them. The reviewer has no web access, and the UI says so.
- **Costs are estimates.** Every paid call records a `CostEntry` using the pricing on the Settings page. Batch budgets are hard stops checked before each paid step.

Scores (concepts and hooks) are AI editorial heuristics, not predictions of audience performance.

---

## Local development

Requirements: Node 22+ (24 tested), pnpm 11, a Postgres database.

```bash
pnpm install
cp .env.example .env              # fill in what you have (Next.js and Prisma both read .env)
pnpm db:migrate                   # applies prisma/migrations
pnpm dev                          # http://localhost:3000
pnpm trigger:dev                  # in a second terminal: runs background jobs locally
```

Local Postgres options:

- A Neon branch (recommended — same driver as production), or
- `pnpm prisma dev -d --name iws` — prints a local `postgres://` URL. It serves one connection at a time, so also set `DATABASE_POOL_MAX=1`.

For local rendering without Vercel Sandbox set `RENDER_PROVIDER=local`. The Trigger.dev dev worker then renders with Remotion on your machine. If Remotion's downloaded headless browser fails to start (seen on recent macOS), point `REMOTION_BROWSER_EXECUTABLE` at a working Chromium headless shell, e.g. the one Playwright installs:

```bash
pnpm exec playwright install chromium
find ~/Library/Caches/ms-playwright -name chrome-headless-shell -type f
```

Preview the composition: `pnpm remotion:studio`.

There are no mock providers in the app. Steps whose credentials are missing fail with an error naming the variable to set; the dashboard shows a setup checklist.

---

## Environment variables

See `.env.example` for the full list with comments. Summary:

| Variable | Used for |
|---|---|
| `DATABASE_URL` / `DIRECT_URL` | Neon pooled URL (app + jobs) / direct URL (migrations) |
| `OPENAI_API_KEY`, `OPENAI_TEXT_MODEL`, `OPENAI_TEXT_MODEL_FAST`, `OPENAI_IMAGE_MODEL`, `OPENAI_IMAGE_SIZE` | Writing, reviews, illustrations |
| `ELEVENLABS_API_KEY`, `ELEVENLABS_MODEL_ID`, `ELEVENLABS_DEFAULT_VOICE_ID` | Narration with timestamps |
| `BLOB_READ_WRITE_TOKEN` | Asset storage |
| `TRIGGER_SECRET_KEY`, `TRIGGER_PROJECT_REF` | Background jobs |
| `RENDER_PROVIDER` | `vercel-sandbox` (prod) or `local` |
| `RENDER_API_SECRET` | Shared secret for internal render routes (≥32 chars) |
| `STUDIO_APP_URL` | Deployment URL Trigger.dev calls for renders |
| `VERCEL_AUTOMATION_BYPASS_SECRET` | Lets Trigger.dev pass Deployment Protection |
| `RENDER_SANDBOX_VCPUS` | Sandbox size (default 4) |

Model names are configurable because availability and naming change; confirm current models in the OpenAI and ElevenLabs dashboards.

---

## Production setup

### 1. Neon
1. Create a Neon project (or install Neon from the Vercel Marketplace, which sets `DATABASE_URL` for you).
2. Copy the **pooled** connection string to `DATABASE_URL` and the **direct** one to `DIRECT_URL`.
3. Apply migrations: `DIRECT_URL=... pnpm db:deploy`.

### 2. Vercel project
1. Import the repository into Vercel. The build command is `pnpm build` (runs `prisma generate`, bundles the Remotion composition into `remotion-bundle/`, then `next build`).
2. Add a **Blob store** to the project (Storage → Blob); this sets `BLOB_READ_WRITE_TOKEN`.
3. Add every variable from `.env.example` in Project Settings → Environment Variables.
4. Set `STUDIO_APP_URL` to the production URL and generate `RENDER_API_SECRET` with `openssl rand -hex 32`.
5. The render-start route uses `maxDuration = 800` seconds to create the sandbox. That requires Fluid Compute on a plan that allows it (Pro or above); the render itself runs detached inside the sandbox.
6. Vercel Sandbox authenticates through the project's OIDC token, which Vercel Functions receive automatically. No extra token is needed for the render routes.

### 3. Vercel Authentication (Deployment Protection)
The app has no login of its own. Protect it with Vercel Authentication:

1. Project → **Settings → Deployment Protection**.
2. Enable **Vercel Authentication**.
3. Set the scope to **All Deployments**. The default "Standard Protection" leaves your production domain public; "All Deployments" also protects the production domain and custom domains. Depending on your plan this may require the Advanced Deployment Protection add-on — check the options your plan shows.
4. Under **Protection Bypass for Automation**, create a secret and copy it to `VERCEL_AUTOMATION_BYPASS_SECRET` (in Vercel and in Trigger.dev). Trigger.dev sends it as `x-vercel-protection-bypass` when calling the render routes.
5. Visit the production URL in a private window and confirm you're asked to sign in to Vercel.

Deployment Protection only gates browsers. The internal render routes independently require `Authorization: Bearer $RENDER_API_SECRET` and use a constant-time comparison; they refuse to run if the secret is missing or shorter than 32 characters.

### 4. Trigger.dev
1. Create a project at trigger.dev; set `TRIGGER_PROJECT_REF` (e.g. `proj_abc123`).
2. In the Trigger.dev dashboard set the **Production** environment variables: `DATABASE_URL`, `OPENAI_*`, `ELEVENLABS_*`, `BLOB_READ_WRITE_TOKEN`, `RENDER_PROVIDER=vercel-sandbox`, `RENDER_API_SECRET`, `STUDIO_APP_URL`, `VERCEL_AUTOMATION_BYPASS_SECRET`.
3. Set `TRIGGER_SECRET_KEY` (the `tr_prod_…` key) in Vercel so the app can queue jobs.
4. Deploy tasks: `pnpm trigger:deploy` (run `pnpm exec trigger.dev login` first). Re-deploy whenever `src/lib/**` or `src/trigger/**` change.

### 5. Narrator voices
Settings → Narrator voices → **Load from ElevenLabs**, add the voice(s) you want, save. Then review **Provider pricing** and replace the placeholder rates with your actual plan's prices.

### 6. Smoke test
Generate 1 concept in Concept mode (cents), open the batch, produce it, and watch Generation Jobs. A 75-second episode typically takes a few minutes, most of it rendering.

---

## Security

- **No browser-side secrets.** All provider calls run in server actions, route handlers, or Trigger.dev tasks. Client components receive only display data.
- **Machine endpoints are authenticated independently** of Deployment Protection (bearer secret, constant-time comparison, Zod-validated bodies).
- **Asset URLs.** Images, audio and MP4s are stored as *public* Vercel Blob objects with random suffixes so the renderer inside Vercel Sandbox can fetch them without credentials. The URLs are unguessable but not secret: anyone who has a URL can open that file. Don't put sensitive material in this app.
- **Audio provenance.** Only add music/SFX you own, that is public domain, or that you hold a license for. License, source and attribution are stored with each asset.

---

## Testing

```bash
pnpm typecheck
pnpm lint
pnpm test                               # unit tests (no DB needed)
```

**Integration tests** run the real pipeline (ideation, writing, revisions, images, narration timing, rendering hand-off, approval, continuation, versioning, budgets) against a real database with deterministic fake providers that live only in `tests/`:

```bash
pnpm prisma dev -d --name iws-test      # note the printed postgres:// URL
DATABASE_URL=<url> pnpm prisma migrate deploy
TEST_DATABASE_URL=<url> DATABASE_POOL_MAX=1 pnpm test
```

**Browser tests** (Playwright) seed a disposable database and exercise every page, including the approve → bible update → continuation-unlocked flow and the mobile layout:

```bash
pnpm build
E2E_DATABASE_URL=<url> DATABASE_POOL_MAX=1 pnpm test:e2e
```

The seed script truncates all tables and refuses to run against a `neon.tech` URL or without `ALLOW_E2E_SEED=1` (set automatically by the Playwright setup).

---

## Operations

- **A job failed.** Open Generation Jobs: the error, failed scenes, or continuity conflicts are shown. **Retry** resumes from the first missing artifact.
- **"Material continuity conflicts remain."** Production stopped before media spend. Read the conflicts on the episode page, edit the story bible if the bible is wrong, or use **Rewrite & produce anyway**.
- **Budget limit reached.** Raise the batch budget by starting a new batch, or produce the remaining episodes individually from the batch page.
- **Render failed in sandbox.** Check the Vercel function logs for `/api/internal/render/start`. Make sure `pnpm build` produced `remotion-bundle/` (it's included in the function via `outputFileTracingIncludes`).
- **Captions or scenes out of sync.** Timing always derives from the voiceover's character alignment. Regenerate the voiceover to rebuild it.
- **Canceling** marks the job canceled immediately and cancels the Trigger.dev run; running stages stop at their next checkpoint. Assets already generated are kept.

---

## Project layout

```
prisma/schema.prisma           Data model (stories, bibles, versions, scenes, assets, jobs, costs)
src/app/                       Pages and server actions (actions.ts)
  api/internal/render/*        Secret-authenticated Vercel Sandbox render routes
src/components/                App shell, shared UI, shadcn/ui
src/lib/
  ai/                          Prompts, strict structured outputs with bounded retries
  pipeline/                    Ideation, writing, illustrations, voiceover, render, versions, context
  providers/                   OpenAI Images, ElevenLabs
  render/                      Render clients (Vercel Sandbox, local)
  schemas/                     Zod schemas for every AI response and the story bible
  costs/                       Pricing, estimates, usage recording, budgets
  timing.ts                    Alignment → words → scene boundaries → captions
  invalidation.ts              Regeneration dependency rules
src/remotion/                  Remotion composition (1080×1920, 30fps, H.264/AAC)
src/trigger/tasks.ts           Trigger.dev tasks
tests/unit|integration|e2e     Vitest + Playwright
```
