-- CreateEnum
CREATE TYPE "ReferenceVerification" AS ENUM ('NEEDS_SOURCE', 'USER_ENTERED', 'SOURCE_CONFIRMED');

-- CreateEnum
CREATE TYPE "MetricSource" AS ENUM ('MANUAL', 'YOUTUBE_API');

-- CreateEnum
CREATE TYPE "TopicStrategy" AS ENUM ('EVIDENCE_BACKED', 'ADJACENT', 'EXPLORATORY');

-- CreateEnum
CREATE TYPE "EvidenceLevel" AS ENUM ('VERIFIED', 'REPORTED', 'NONE');

-- CreateEnum
CREATE TYPE "TopicStatus" AS ENUM ('PROPOSED', 'APPROVED', 'REJECTED', 'DUPLICATE', 'USED');

-- CreateEnum
CREATE TYPE "StorytellingPattern" AS ENUM ('TRANSFORMATION', 'HIDDEN_PROBLEM', 'FACTORY_REVEAL');

-- AlterEnum
ALTER TYPE "JobType" ADD VALUE 'TOPIC_DISCOVERY';

-- AlterTable
ALTER TABLE "Story" ADD COLUMN     "discovery" JSONB,
ADD COLUMN     "topicCandidateId" TEXT;

-- AlterTable
ALTER TABLE "Concept" ADD COLUMN     "discovery" JSONB;

-- CreateTable
CREATE TABLE "ManufacturingContentReference" (
    "id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "creator" TEXT NOT NULL,
    "url" TEXT,
    "title" TEXT NOT NULL,
    "product" TEXT NOT NULL,
    "normalizedProduct" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "durationSec" INTEGER,
    "notableStep" TEXT NOT NULL DEFAULT '',
    "curiosityMechanism" TEXT NOT NULL DEFAULT '',
    "observedHook" TEXT NOT NULL DEFAULT '',
    "transformationType" TEXT NOT NULL DEFAULT '',
    "verification" "ReferenceVerification" NOT NULL DEFAULT 'USER_ENTERED',
    "notes" TEXT NOT NULL DEFAULT '',
    "usageRights" TEXT NOT NULL DEFAULT 'Reference only; not licensed for reuse',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ManufacturingContentReference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferenceMetricObservation" (
    "id" TEXT NOT NULL,
    "referenceId" TEXT NOT NULL,
    "views" INTEGER,
    "likes" INTEGER,
    "comments" INTEGER,
    "shares" INTEGER,
    "observedAt" TIMESTAMP(3) NOT NULL,
    "source" "MetricSource" NOT NULL DEFAULT 'MANUAL',
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferenceMetricObservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManufacturingTopicCandidate" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "batchId" TEXT,
    "jobId" TEXT,
    "conceptId" TEXT,
    "product" TEXT NOT NULL,
    "normalizedProduct" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "episodeConcept" TEXT NOT NULL,
    "premise" TEXT NOT NULL,
    "arc" TEXT NOT NULL,
    "strategy" "TopicStrategy" NOT NULL,
    "evidenceLevel" "EvidenceLevel" NOT NULL,
    "whyViewers" TEXT NOT NULL,
    "featuredStage" TEXT NOT NULL,
    "curiosityAngle" TEXT NOT NULL,
    "visualPayoff" TEXT NOT NULL,
    "researchFeasibility" TEXT NOT NULL,
    "visualFeasibility" TEXT NOT NULL,
    "ratings" JSONB,
    "score" DOUBLE PRECISION,
    "scoreBreakdown" JSONB,
    "status" "TopicStatus" NOT NULL DEFAULT 'PROPOSED',
    "duplicateOf" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ManufacturingTopicCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TopicEvidence" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "referenceId" TEXT NOT NULL,
    "relation" TEXT NOT NULL,

    CONSTRAINT "TopicEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManufacturingStorytellingDecision" (
    "id" TEXT NOT NULL,
    "storyId" TEXT NOT NULL,
    "pattern" "StorytellingPattern" NOT NULL,
    "patternSource" TEXT NOT NULL DEFAULT 'recommended',
    "reason" TEXT NOT NULL,
    "curiosityMechanism" TEXT NOT NULL,
    "featuredStageId" TEXT NOT NULL,
    "visualPayoff" TEXT NOT NULL,
    "alternatives" "StorytellingPattern"[],
    "stageVisuals" JSONB NOT NULL,
    "selectedHookId" TEXT,
    "researchedAt" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ManufacturingStorytellingDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManufacturingHookCandidate" (
    "id" TEXT NOT NULL,
    "storyId" TEXT NOT NULL,
    "pattern" "StorytellingPattern" NOT NULL,
    "line" TEXT NOT NULL,
    "strategy" TEXT NOT NULL,
    "claimIds" TEXT[],
    "featuredStageId" TEXT NOT NULL,
    "firstFrameVisual" TEXT NOT NULL,
    "whyItWorks" TEXT NOT NULL,
    "uncertainty" TEXT NOT NULL DEFAULT '',
    "visual" JSONB NOT NULL,
    "flags" TEXT[],
    "review" JSONB,
    "total" DOUBLE PRECISION,
    "rank" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ManufacturingHookCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ManufacturingContentReference_url_key" ON "ManufacturingContentReference"("url");

-- CreateIndex
CREATE INDEX "ManufacturingContentReference_platform_idx" ON "ManufacturingContentReference"("platform");

-- CreateIndex
CREATE INDEX "ManufacturingContentReference_category_idx" ON "ManufacturingContentReference"("category");

-- CreateIndex
CREATE INDEX "ManufacturingContentReference_normalizedProduct_idx" ON "ManufacturingContentReference"("normalizedProduct");

-- CreateIndex
CREATE INDEX "ReferenceMetricObservation_referenceId_observedAt_idx" ON "ReferenceMetricObservation"("referenceId", "observedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ManufacturingTopicCandidate_conceptId_key" ON "ManufacturingTopicCandidate"("conceptId");

-- CreateIndex
CREATE INDEX "ManufacturingTopicCandidate_channelId_createdAt_idx" ON "ManufacturingTopicCandidate"("channelId", "createdAt");

-- CreateIndex
CREATE INDEX "ManufacturingTopicCandidate_normalizedProduct_idx" ON "ManufacturingTopicCandidate"("normalizedProduct");

-- CreateIndex
CREATE INDEX "ManufacturingTopicCandidate_batchId_idx" ON "ManufacturingTopicCandidate"("batchId");

-- CreateIndex
CREATE INDEX "ManufacturingTopicCandidate_jobId_idx" ON "ManufacturingTopicCandidate"("jobId");

-- CreateIndex
CREATE INDEX "TopicEvidence_referenceId_idx" ON "TopicEvidence"("referenceId");

-- CreateIndex
CREATE UNIQUE INDEX "TopicEvidence_candidateId_referenceId_key" ON "TopicEvidence"("candidateId", "referenceId");

-- CreateIndex
CREATE UNIQUE INDEX "ManufacturingStorytellingDecision_storyId_key" ON "ManufacturingStorytellingDecision"("storyId");

-- CreateIndex
CREATE UNIQUE INDEX "ManufacturingStorytellingDecision_selectedHookId_key" ON "ManufacturingStorytellingDecision"("selectedHookId");

-- CreateIndex
CREATE INDEX "ManufacturingHookCandidate_storyId_pattern_idx" ON "ManufacturingHookCandidate"("storyId", "pattern");

-- AddForeignKey
ALTER TABLE "Story" ADD CONSTRAINT "Story_topicCandidateId_fkey" FOREIGN KEY ("topicCandidateId") REFERENCES "ManufacturingTopicCandidate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferenceMetricObservation" ADD CONSTRAINT "ReferenceMetricObservation_referenceId_fkey" FOREIGN KEY ("referenceId") REFERENCES "ManufacturingContentReference"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManufacturingTopicCandidate" ADD CONSTRAINT "ManufacturingTopicCandidate_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManufacturingTopicCandidate" ADD CONSTRAINT "ManufacturingTopicCandidate_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManufacturingTopicCandidate" ADD CONSTRAINT "ManufacturingTopicCandidate_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "Job"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManufacturingTopicCandidate" ADD CONSTRAINT "ManufacturingTopicCandidate_conceptId_fkey" FOREIGN KEY ("conceptId") REFERENCES "Concept"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TopicEvidence" ADD CONSTRAINT "TopicEvidence_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "ManufacturingTopicCandidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TopicEvidence" ADD CONSTRAINT "TopicEvidence_referenceId_fkey" FOREIGN KEY ("referenceId") REFERENCES "ManufacturingContentReference"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManufacturingStorytellingDecision" ADD CONSTRAINT "ManufacturingStorytellingDecision_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "Story"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManufacturingStorytellingDecision" ADD CONSTRAINT "ManufacturingStorytellingDecision_selectedHookId_fkey" FOREIGN KEY ("selectedHookId") REFERENCES "ManufacturingHookCandidate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ManufacturingHookCandidate" ADD CONSTRAINT "ManufacturingHookCandidate_storyId_fkey" FOREIGN KEY ("storyId") REFERENCES "Story"("id") ON DELETE CASCADE ON UPDATE CASCADE;

