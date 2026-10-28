-- CreateEnum
CREATE TYPE "StoryStatus" AS ENUM ('CONCEPT', 'IN_PRODUCTION', 'READY', 'PUBLISHED', 'CONTINUING', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "FactMode" AS ENUM ('FACTUAL', 'HYPOTHETICAL', 'FICTIONAL', 'MIXED');

-- CreateEnum
CREATE TYPE "EpisodeStatus" AS ENUM ('DRAFT', 'SCRIPTED', 'IN_PRODUCTION', 'READY', 'APPROVED', 'PUBLISHED', 'FAILED');

-- CreateEnum
CREATE TYPE "VersionStatus" AS ENUM ('DRAFT', 'APPROVED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "FactCheckStatus" AS ENUM ('PENDING', 'PASSED', 'NEEDS_REVIEW', 'MANUALLY_APPROVED');

-- CreateEnum
CREATE TYPE "ClaimClassification" AS ENUM ('ESTABLISHED_FACT', 'PLAUSIBLE_EXAMPLE', 'FICTIONAL', 'NEEDS_VERIFICATION');

-- CreateEnum
CREATE TYPE "ClaimStatus" AS ENUM ('UNVERIFIED', 'SUPPORTED', 'FLAGGED', 'REVISED', 'MANUALLY_VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "HookType" AS ENUM ('RELATABLE', 'SURPRISING_FACT', 'IMMEDIATE_DANGER', 'QUESTION', 'OTHER');

-- CreateEnum
CREATE TYPE "AssetStatus" AS ENUM ('PENDING', 'GENERATING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "BatchMode" AS ENUM ('CONCEPT', 'FULL_PRODUCTION');

-- CreateEnum
CREATE TYPE "Quality" AS ENUM ('DRAFT', 'STANDARD', 'PREMIUM');

-- CreateEnum
CREATE TYPE "ConceptStatus" AS ENUM ('CANDIDATE', 'SELECTED', 'REJECTED', 'DUPLICATE');

-- CreateEnum
CREATE TYPE "JobType" AS ENUM ('BATCH_IDEATION', 'EPISODE_PRODUCTION', 'CONTINUATION', 'REGENERATE_HOOKS', 'REGENERATE_SCRIPT', 'REGENERATE_SCENE_NARRATION', 'REGENERATE_IMAGE', 'REGENERATE_VOICEOVER', 'RENDER');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'GENERATING_IDEAS', 'EVALUATING_CONCEPTS', 'WRITING_STORY', 'GENERATING_SCENES', 'GENERATING_ILLUSTRATIONS', 'GENERATING_VOICEOVER', 'SYNCHRONIZING_NARRATION', 'RENDERING_VIDEO', 'UPLOADING_MP4', 'COMPLETED', 'FAILED', 'CANCELED');

-- CreateEnum
CREATE TYPE "Provider" AS ENUM ('OPENAI_TEXT', 'OPENAI_IMAGE', 'ELEVENLABS', 'VERCEL_SANDBOX');

-- CreateEnum
CREATE TYPE "ProposalStatus" AS ENUM ('PENDING', 'APPLIED', 'REJECTED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "AudioAssetKind" AS ENUM ('MUSIC', 'SFX');

-- CreateTable
CREATE TABLE "Story" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "normalizedTitle" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "premise" TEXT NOT NULL,
    "logline" TEXT,
    "keywords" TEXT[],
    "status" "StoryStatus" NOT NULL DEFAULT 'CONCEPT',
    "factMode" "FactMode" NOT NULL DEFAULT 'MIXED',
    "styleKey" TEXT NOT NULL DEFAULT 'stick-figure',
    "voiceId" TEXT,
    "targetDurationSec" INTEGER NOT NULL DEFAULT 75,
    "quality" "Quality" NOT NULL DEFAULT 'STANDARD',
    "thumbnailUrl" TEXT,
    "hasUnresolvedThreads" BOOLEAN NOT NULL DEFAULT true,
    "archivedAt" TIMESTAMP(3),
    "lastActivityAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "conceptId" TEXT,

    CONSTRAINT "Story_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoryBible" (
    "id" TEXT NOT NULL,
    "storyId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "data" JSONB NOT NULL,
    "source" TEXT NOT NULL,
    "sourceEpisodeId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoryBible_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BibleUpdateProposal" (
    "id" TEXT NOT NULL,
    "storyId" TEXT NOT NULL,
    "episodeVersionId" TEXT NOT NULL,
    "baseBibleVersion" INTEGER NOT NULL,
    "update" JSONB NOT NULL,
    "status" "ProposalStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "BibleUpdateProposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VisualReference" (
    "id" TEXT NOT NULL,
    "storyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "imageUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VisualReference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Episode" (
    "id" TEXT NOT NULL,
    "storyId" TEXT NOT NULL,
    "partNumber" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "status" "EpisodeStatus" NOT NULL DEFAULT 'DRAFT',
    "currentVersionId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "publishedUrl" TEXT,
    "publishedPlatform" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Episode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EpisodeVersion" (
    "id" TEXT NOT NULL,
    "episodeId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "VersionStatus" NOT NULL DEFAULT 'DRAFT',
    "parentVersionId" TEXT,
    "reason" TEXT NOT NULL,
    "spec" JSONB NOT NULL,
    "narration" TEXT NOT NULL,
    "wordCount" INTEGER NOT NULL,
    "estimatedDurationSec" DOUBLE PRECISION NOT NULL,
    "summary" TEXT NOT NULL,
    "factCheckStatus" "FactCheckStatus" NOT NULL DEFAULT 'PENDING',
    "factReview" JSONB,
    "continuityReview" JSONB,
    "styleKey" TEXT NOT NULL,
    "voiceoverId" TEXT,
    "timing" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EpisodeVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Hook" (
    "id" TEXT NOT NULL,
    "episodeId" TEXT NOT NULL,
    "type" "HookType" NOT NULL,
    "text" TEXT NOT NULL,
    "scores" JSONB NOT NULL,
    "totalScore" DOUBLE PRECISION NOT NULL,
    "rationale" TEXT NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "round" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Hook_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Scene" (
    "id" TEXT NOT NULL,
    "episodeVersionId" TEXT NOT NULL,
    "sceneNumber" INTEGER NOT NULL,
    "narration" TEXT NOT NULL,
    "imagePrompt" TEXT NOT NULL,
    "composition" TEXT NOT NULL,
    "characters" TEXT[],
    "objects" TEXT[],
    "intendedDurationSec" DOUBLE PRECISION NOT NULL,
    "motionPreset" TEXT NOT NULL,
    "currentImageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Scene_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SceneImage" (
    "id" TEXT NOT NULL,
    "sceneId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "AssetStatus" NOT NULL DEFAULT 'PENDING',
    "url" TEXT,
    "blobPath" TEXT,
    "prompt" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "quality" TEXT NOT NULL,
    "usedReference" BOOLEAN NOT NULL DEFAULT false,
    "review" JSONB,
    "error" TEXT,
    "costUsd" DECIMAL(12,6) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SceneImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Voiceover" (
    "id" TEXT NOT NULL,
    "episodeVersionId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "AssetStatus" NOT NULL DEFAULT 'PENDING',
    "voiceId" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "settings" JSONB NOT NULL,
    "text" TEXT NOT NULL,
    "url" TEXT,
    "blobPath" TEXT,
    "durationMs" INTEGER,
    "alignment" JSONB,
    "words" JSONB,
    "characterCount" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "costUsd" DECIMAL(12,6) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Voiceover_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Render" (
    "id" TEXT NOT NULL,
    "episodeVersionId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "AssetStatus" NOT NULL DEFAULT 'PENDING',
    "inputs" JSONB NOT NULL,
    "inputProps" JSONB NOT NULL,
    "url" TEXT,
    "sizeBytes" INTEGER,
    "durationSec" DOUBLE PRECISION,
    "sandboxId" TEXT,
    "commandId" TEXT,
    "progress" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "error" TEXT,
    "costUsd" DECIMAL(12,6) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "Render_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FactClaim" (
    "id" TEXT NOT NULL,
    "storyId" TEXT NOT NULL,
    "episodeVersionId" TEXT NOT NULL,
    "claim" TEXT NOT NULL,
    "classification" "ClaimClassification" NOT NULL,
    "status" "ClaimStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "reasoning" TEXT NOT NULL,
    "references" TEXT[],
    "resolutionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FactClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PerformanceMetric" (
    "id" TEXT NOT NULL,
    "episodeId" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "views" INTEGER,
    "likes" INTEGER,
    "comments" INTEGER,
    "shares" INTEGER,
    "saves" INTEGER,
    "followersGained" INTEGER,
    "avgWatchTimeSec" DOUBLE PRECISION,
    "completionRate" DOUBLE PRECISION,
    "notes" TEXT,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PerformanceMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Batch" (
    "id" TEXT NOT NULL,
    "mode" "BatchMode" NOT NULL,
    "category" TEXT NOT NULL,
    "customDirection" TEXT,
    "requestedCount" INTEGER NOT NULL,
    "targetDurationSec" INTEGER NOT NULL,
    "styleKey" TEXT NOT NULL,
    "voiceId" TEXT NOT NULL,
    "quality" "Quality" NOT NULL,
    "maxBudgetUsd" DECIMAL(12,6) NOT NULL,
    "autoSelect" BOOLEAN NOT NULL DEFAULT false,
    "estimatedCostUsd" DECIMAL(12,6) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Batch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Concept" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "normalizedTitle" TEXT NOT NULL,
    "premise" TEXT NOT NULL,
    "logline" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "keywords" TEXT[],
    "factMode" "FactMode" NOT NULL,
    "seriesPotential" TEXT NOT NULL,
    "scores" JSONB,
    "totalScore" DOUBLE PRECISION,
    "rank" INTEGER,
    "status" "ConceptStatus" NOT NULL DEFAULT 'CANDIDATE',
    "duplicateOfTitle" TEXT,
    "similarity" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Concept_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "type" "JobType" NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "stage" TEXT,
    "progress" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "input" JSONB NOT NULL,
    "output" JSONB,
    "error" JSONB,
    "triggerRunId" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "batchId" TEXT,
    "storyId" TEXT,
    "episodeId" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CostEntry" (
    "id" TEXT NOT NULL,
    "provider" "Provider" NOT NULL,
    "model" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "usage" JSONB NOT NULL,
    "costUsd" DECIMAL(12,6) NOT NULL,
    "estimated" BOOLEAN NOT NULL DEFAULT true,
    "jobId" TEXT,
    "storyId" TEXT,
    "episodeId" TEXT,
    "batchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CostEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "AudioAsset" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "AudioAssetKind" NOT NULL,
    "url" TEXT NOT NULL,
    "license" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "attribution" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AudioAsset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Story_conceptId_key" ON "Story"("conceptId");

-- CreateIndex
CREATE INDEX "Story_status_idx" ON "Story"("status");

-- CreateIndex
CREATE INDEX "Story_normalizedTitle_idx" ON "Story"("normalizedTitle");

-- CreateIndex
CREATE INDEX "Story_lastActivityAt_idx" ON "Story"("lastActivityAt");

-- CreateIndex
CREATE UNIQUE INDEX "StoryBible_storyId_version_key" ON "StoryBible"("storyId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "BibleUpdateProposal_episodeVersionId_key" ON "BibleUpdateProposal"("episodeVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "VisualReference_storyId_name_key" ON "VisualReference"("storyId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Episode_currentVersionId_key" ON "Episode"("currentVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "Episode_storyId_partNumber_key" ON "Episode"("storyId", "partNumber");

-- CreateIndex
CREATE UNIQUE INDEX "EpisodeVersion_episodeId_version_key" ON "EpisodeVersion"("episodeId", "version");

-- CreateIndex
CREATE INDEX "Hook_episodeId_idx" ON "Hook"("episodeId");

-- CreateIndex
CREATE UNIQUE INDEX "Scene_episodeVersionId_sceneNumber_key" ON "Scene"("episodeVersionId", "sceneNumber");

-- CreateIndex
CREATE INDEX "SceneImage_sceneId_idx" ON "SceneImage"("sceneId");

-- CreateIndex
CREATE INDEX "Render_episodeVersionId_idx" ON "Render"("episodeVersionId");

-- CreateIndex
CREATE INDEX "FactClaim_episodeVersionId_idx" ON "FactClaim"("episodeVersionId");

-- CreateIndex
CREATE INDEX "Concept_batchId_idx" ON "Concept"("batchId");

-- CreateIndex
CREATE INDEX "Job_status_idx" ON "Job"("status");

-- CreateIndex
CREATE INDEX "Job_createdAt_idx" ON "Job"("createdAt");

-- CreateIndex
CREATE INDEX "CostEntry_batchId_idx" ON "CostEntry"("batchId");

-- CreateIndex
CREATE INDEX "CostEntry_storyId_idx" ON "CostEntry"("storyId");

-- CreateIndex
CREATE INDEX "CostEntry_createdAt_idx" ON "CostEntry"("createdAt");

-- AddForeignKey
ALTER TABLE "Story" ADD CONSTRAINT "Story_conceptId_fkey" FOREIGN KEY ("conceptId") REFERENCES "Concept"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StoryBible" ADD CONSTRAINT "StoryBible_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "Story"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BibleUpdateProposal" ADD CONSTRAINT "BibleUpdateProposal_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "Story"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BibleUpdateProposal" ADD CONSTRAINT "BibleUpdateProposal_episodeVersionId_fkey" FOREIGN KEY ("episodeVersionId") REFERENCES "EpisodeVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VisualReference" ADD CONSTRAINT "VisualReference_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "Story"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Episode" ADD CONSTRAINT "Episode_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "Story"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Episode" ADD CONSTRAINT "Episode_currentVersionId_fkey" FOREIGN KEY ("currentVersionId") REFERENCES "EpisodeVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EpisodeVersion" ADD CONSTRAINT "EpisodeVersion_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "Episode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EpisodeVersion" ADD CONSTRAINT "EpisodeVersion_voiceoverId_fkey" FOREIGN KEY ("voiceoverId") REFERENCES "Voiceover"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Hook" ADD CONSTRAINT "Hook_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "Episode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scene" ADD CONSTRAINT "Scene_episodeVersionId_fkey" FOREIGN KEY ("episodeVersionId") REFERENCES "EpisodeVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scene" ADD CONSTRAINT "Scene_currentImageId_fkey" FOREIGN KEY ("currentImageId") REFERENCES "SceneImage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SceneImage" ADD CONSTRAINT "SceneImage_sceneId_fkey" FOREIGN KEY ("sceneId") REFERENCES "Scene"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Voiceover" ADD CONSTRAINT "Voiceover_episodeVersionId_fkey" FOREIGN KEY ("episodeVersionId") REFERENCES "EpisodeVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Render" ADD CONSTRAINT "Render_episodeVersionId_fkey" FOREIGN KEY ("episodeVersionId") REFERENCES "EpisodeVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FactClaim" ADD CONSTRAINT "FactClaim_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "Story"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FactClaim" ADD CONSTRAINT "FactClaim_episodeVersionId_fkey" FOREIGN KEY ("episodeVersionId") REFERENCES "EpisodeVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PerformanceMetric" ADD CONSTRAINT "PerformanceMetric_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "Episode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Concept" ADD CONSTRAINT "Concept_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "Story"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "Episode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostEntry" ADD CONSTRAINT "CostEntry_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostEntry" ADD CONSTRAINT "CostEntry_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "Story"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostEntry" ADD CONSTRAINT "CostEntry_episodeId_fkey" FOREIGN KEY ("episodeId") REFERENCES "Episode"("id") ON DELETE SET NULL ON UPDATE CASCADE;
