# The Invisible World Studio

A private studio for producing narrated, illustrated explainer videos for TikTok channels (also Shorts and Reels). You paste your own script and choose how many videos to split it into. The studio storyboards it word for word, illustrates the shots, records the narration and renders 1080×1920 MP4s. It never writes or changes your narration.

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
Make Videos: channel + pasted script + number of videos (+ optional picture notes, title, hook text)
  live estimate: length per video from the voice's measured pace, and cost
  ──► Story with Parts 1..N ──► Trigger.dev "script-job"          (see docs/channels.md)
   1. Split (N > 1): one model call picks the sentences where Parts 2..N start; code cuts the text,
      so the parts joined are your script exactly. Invalid breaks fall back to an even split by length.
   2. Storyboard each part (Part 1 first; the rest keep its look): shots cut word for word from your
      narration, image prompts, step labels, sound effects, the visual state, title and on-screen hook
  ──► one "episode-job" per part, straight to video:
   3. Illustrate shots (OpenAI Images, style references, per-image checks and one redraw)
   4. Narrate (ElevenLabs with character timestamps)
   5. Synchronize: scene boundaries + word-level captions from the real alignment
   6. Render: Vercel Sandbox (Remotion) → MP4 uploaded to Vercel Blob, then the post text
```

Key design rules:

- **Every artifact is versioned and immutable.** Script versions, scene images, voiceovers and renders are separate rows; "current" pointers choose what is live. Approved versions are locked — any change forks a new draft version.
- **Your words, exactly.** The model never writes narration. Every storyboard is checked word for word against your text and sent back if it differs, and the saved shots are re-cut from your original text, so your punctuation and capitals are what is spoken and captioned.
- **Minimal regeneration.** Editing a shot's picture description redraws only that shot. Editing its words records a new voiceover. Editing the title or hook text only re-renders. Every edit forks a version (see `src/lib/invalidation.ts`).
- **Resumable jobs.** Each stage skips work whose artifact already exists, so retrying a failed job resumes rather than repaying for completed steps. A storyboard retry redoes only the parts that failed, and a failed scene image never discards the others.
- **Costs are estimates.** Every paid call records a `CostEntry` using the pricing on the Settings page.

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
| `OPENAI_API_KEY`, `OPENAI_TEXT_MODEL`, `OPENAI_TEXT_MODEL_FAST`, `OPENAI_IMAGE_MODEL`, `OPENAI_IMAGE_SIZE` | Storyboards, image checks, post text, illustrations |
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
On Make Videos, paste a short script (a hundred words or so), choose 1 video and press Make. Watch the story page while it's storyboarded, then the episode while its video is made; that takes a few minutes, most of it rendering.

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

**Integration tests** run the real pipeline (splitting, storyboarding, hand edits, images, narration timing, rendering hand-off, approval, versioning, budgets) against a real database with deterministic fake providers that live only in `tests/`:

```bash
pnpm prisma dev -d --name iws-test      # note the printed postgres:// URL
DIRECT_URL=<url> DATABASE_URL=<url> pnpm prisma migrate deploy
TEST_DATABASE_URL=<url> DATABASE_POOL_MAX=1 pnpm test
```

**Local prisma commands:** `prisma.config.ts` prefers `DIRECT_URL`, which `.env` points at production. Set `DIRECT_URL` as well as `DATABASE_URL` to the test database when migrating it.

**Browser tests** (Playwright) seed a disposable database and exercise every page, including the paste form's estimate, editing a shot, approval and the mobile layout:

```bash
pnpm build
E2E_DATABASE_URL=<url> DATABASE_POOL_MAX=1 pnpm test:e2e
```

The seed script truncates all tables and refuses to run against a `neon.tech` URL or without `ALLOW_E2E_SEED=1` (set automatically by the Playwright setup).

---

## Operations

- **A job failed.** Open Generation Jobs: the error or failed scenes are shown. **Retry** resumes from the first missing artifact.
- **Storyboarding failed.** The story page shows the error. Retry it on Generation Jobs: parts already storyboarded are kept.
- **A shot's picture is wrong.** Edit the shot and describe what the picture should show; only that shot is redrawn.
- **Render failed in sandbox.** Check the Vercel function logs for `/api/internal/render/start`. Make sure `pnpm build` produced `remotion-bundle/` (it's included in the function via `outputFileTracingIncludes`).
- **Captions or scenes out of sync.** Timing always derives from the voiceover's character alignment. Regenerate the voiceover to rebuild it.
- **Canceling** marks the job canceled immediately and cancels the Trigger.dev run; running stages stop at their next checkpoint. Assets already generated are kept.

---

## Project layout

```
prisma/schema.prisma           Data model (channels, stories, versions, scenes, assets, jobs, costs)
src/app/                       Pages and server actions (actions.ts)
  api/internal/render/*        Secret-authenticated Vercel Sandbox render routes
src/components/                App shell, shared UI, shadcn/ui
src/lib/
  ai/                          Storyboard, split, image-check and post prompts; channel styles; structured outputs
  pipeline/                    Pasted scripts (paste.ts), illustrations, voiceover, render, post text, versions and edits
  script.ts                    Sentence split, exact part cuts, storyboard checks
  providers/                   OpenAI Images, ElevenLabs
  render/                      Render clients (Vercel Sandbox, local)
  schemas/                     Zod schemas for every AI response
  costs/                       Pricing, estimates, usage recording, budgets
  timing.ts                    Alignment → words → scene boundaries → captions
  invalidation.ts              Regeneration dependency rules
src/remotion/                  Remotion composition (1080×1920, 30fps, H.264/AAC)
src/trigger/tasks.ts           Trigger.dev tasks
tests/unit|integration|e2e     Vitest + Playwright
```
