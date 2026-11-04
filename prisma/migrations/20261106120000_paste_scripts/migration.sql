-- Pasted scripts replace AI script writing (November 2026).
-- Pitches, topic research, storytelling decisions, hooks and script checks are removed.
-- Stories, episodes, versions, scenes, media, renders and cost history are kept.

-- Jobs of removed kinds (pitching, topic research, script writing) are history only.
DELETE FROM "Job" WHERE "type" IN ('BATCH_IDEATION', 'TOPIC_DISCOVERY', 'REGENERATE_SCRIPT', 'REGENERATE_SCENE_NARRATION');
-- A job stuck in a removed stage can never finish.
UPDATE "Job" SET "status" = 'FAILED', "completedAt" = COALESCE("completedAt", now()) WHERE "status" IN ('GENERATING_IDEAS', 'EVALUATING_CONCEPTS', 'WRITING_STORY');

-- AlterEnum
BEGIN;
CREATE TYPE "JobType_new" AS ENUM ('STORYBOARD', 'EPISODE_PRODUCTION', 'REGENERATE_IMAGE', 'REGENERATE_VOICEOVER', 'RENDER');
ALTER TABLE "Job" ALTER COLUMN "type" TYPE "JobType_new" USING ("type"::text::"JobType_new");
ALTER TYPE "JobType" RENAME TO "JobType_old";
ALTER TYPE "JobType_new" RENAME TO "JobType";
DROP TYPE "JobType_old";
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "JobStatus_new" AS ENUM ('QUEUED', 'STORYBOARDING', 'GENERATING_SCENES', 'GENERATING_ILLUSTRATIONS', 'GENERATING_VOICEOVER', 'SYNCHRONIZING_NARRATION', 'RENDERING_VIDEO', 'UPLOADING_MP4', 'COMPLETED', 'FAILED', 'CANCELED');
ALTER TABLE "Job" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Job" ALTER COLUMN "status" TYPE "JobStatus_new" USING ("status"::text::"JobStatus_new");
ALTER TYPE "JobStatus" RENAME TO "JobStatus_old";
ALTER TYPE "JobStatus_new" RENAME TO "JobStatus";
DROP TYPE "JobStatus_old";
ALTER TABLE "Job" ALTER COLUMN "status" SET DEFAULT 'QUEUED';
COMMIT;

-- DropForeignKey
ALTER TABLE "Story" DROP CONSTRAINT "Story_topicCandidateId_fkey";

-- DropForeignKey
ALTER TABLE "Story" DROP CONSTRAINT "Story_conceptId_fkey";

-- DropForeignKey
ALTER TABLE "Batch" DROP CONSTRAINT "Batch_channelId_fkey";

-- DropForeignKey
ALTER TABLE "Concept" DROP CONSTRAINT "Concept_batchId_fkey";

-- DropForeignKey
ALTER TABLE "Job" DROP CONSTRAINT "Job_batchId_fkey";

-- DropForeignKey
ALTER TABLE "ReferenceMetricObservation" DROP CONSTRAINT "ReferenceMetricObservation_referenceId_fkey";

-- DropForeignKey
ALTER TABLE "ManufacturingTopicCandidate" DROP CONSTRAINT "ManufacturingTopicCandidate_channelId_fkey";

-- DropForeignKey
ALTER TABLE "ManufacturingTopicCandidate" DROP CONSTRAINT "ManufacturingTopicCandidate_batchId_fkey";

-- DropForeignKey
ALTER TABLE "ManufacturingTopicCandidate" DROP CONSTRAINT "ManufacturingTopicCandidate_jobId_fkey";

-- DropForeignKey
ALTER TABLE "ManufacturingTopicCandidate" DROP CONSTRAINT "ManufacturingTopicCandidate_conceptId_fkey";

-- DropForeignKey
ALTER TABLE "TopicEvidence" DROP CONSTRAINT "TopicEvidence_candidateId_fkey";

-- DropForeignKey
ALTER TABLE "TopicEvidence" DROP CONSTRAINT "TopicEvidence_referenceId_fkey";

-- DropForeignKey
ALTER TABLE "ManufacturingStorytellingDecision" DROP CONSTRAINT "ManufacturingStorytellingDecision_storyId_fkey";

-- DropForeignKey
ALTER TABLE "ManufacturingStorytellingDecision" DROP CONSTRAINT "ManufacturingStorytellingDecision_selectedHookId_fkey";

-- DropForeignKey
ALTER TABLE "ManufacturingHookCandidate" DROP CONSTRAINT "ManufacturingHookCandidate_storyId_fkey";

-- DropIndex
DROP INDEX "Story_conceptId_key";

-- DropIndex
DROP INDEX "CostEntry_batchId_idx";

-- AlterTable
ALTER TABLE "Channel" DROP COLUMN "brief",
DROP COLUMN "looseOpening",
DROP COLUMN "maxParts",
DROP COLUMN "minParts",
DROP COLUMN "targetDurationSec";

-- AlterTable
ALTER TABLE "Story" DROP COLUMN "conceptId",
DROP COLUMN "discovery",
DROP COLUMN "keywords",
DROP COLUMN "logline",
DROP COLUMN "premise",
DROP COLUMN "research",
DROP COLUMN "storySeed",
DROP COLUMN "topicCandidateId",
ADD COLUMN     "sourceScript" TEXT,
ADD COLUMN     "visualNotes" TEXT;

-- AlterTable
ALTER TABLE "Episode" ADD COLUMN     "script" TEXT;

-- AlterTable
ALTER TABLE "EpisodeVersion" DROP COLUMN "humanRating",
DROP COLUMN "qualityStatus";

-- AlterTable
ALTER TABLE "Job" DROP COLUMN "batchId";

-- AlterTable
ALTER TABLE "CostEntry" DROP COLUMN "batchId";

-- DropTable
DROP TABLE "Batch";

-- DropTable
DROP TABLE "Concept";

-- DropTable
DROP TABLE "ManufacturingContentReference";

-- DropTable
DROP TABLE "ReferenceMetricObservation";

-- DropTable
DROP TABLE "ManufacturingTopicCandidate";

-- DropTable
DROP TABLE "TopicEvidence";

-- DropTable
DROP TABLE "ManufacturingStorytellingDecision";

-- DropTable
DROP TABLE "ManufacturingHookCandidate";

-- DropEnum
DROP TYPE "ConceptStatus";

-- DropEnum
DROP TYPE "ReferenceVerification";

-- DropEnum
DROP TYPE "MetricSource";

-- DropEnum
DROP TYPE "TopicStrategy";

-- DropEnum
DROP TYPE "EvidenceLevel";

-- DropEnum
DROP TYPE "TopicStatus";

-- DropEnum
DROP TYPE "StorytellingPattern";

