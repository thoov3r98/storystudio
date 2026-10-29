-- The studio makes How It's Made videos only: characters, story bibles, hooks, fact claims,
-- reference stories and the character-story channel format are removed.

-- AlterEnum
BEGIN;
CREATE TYPE "JobType_new" AS ENUM ('BATCH_IDEATION', 'EPISODE_PRODUCTION', 'REGENERATE_SCRIPT', 'REGENERATE_SCENE_NARRATION', 'REGENERATE_IMAGE', 'REGENERATE_VOICEOVER', 'RENDER');
ALTER TABLE "Job" ALTER COLUMN "type" TYPE "JobType_new" USING ("type"::text::"JobType_new");
ALTER TYPE "JobType" RENAME TO "JobType_old";
ALTER TYPE "JobType_new" RENAME TO "JobType";
DROP TYPE "JobType_old";
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "ChannelFormat_new" AS ENUM ('PROCESS_EXPLAINER');
ALTER TABLE "Channel" ALTER COLUMN "format" TYPE "ChannelFormat_new" USING ("format"::text::"ChannelFormat_new");
ALTER TYPE "ChannelFormat" RENAME TO "ChannelFormat_old";
ALTER TYPE "ChannelFormat_new" RENAME TO "ChannelFormat";
DROP TYPE "ChannelFormat_old";
COMMIT;

-- DropForeignKey
ALTER TABLE "Channel" DROP CONSTRAINT "Channel_characterId_fkey";

-- DropForeignKey
ALTER TABLE "Story" DROP CONSTRAINT "Story_characterId_fkey";

-- DropForeignKey
ALTER TABLE "StoryBible" DROP CONSTRAINT "StoryBible_storyId_fkey";

-- DropForeignKey
ALTER TABLE "BibleUpdateProposal" DROP CONSTRAINT "BibleUpdateProposal_storyId_fkey";

-- DropForeignKey
ALTER TABLE "BibleUpdateProposal" DROP CONSTRAINT "BibleUpdateProposal_episodeVersionId_fkey";

-- DropForeignKey
ALTER TABLE "VisualReference" DROP CONSTRAINT "VisualReference_storyId_fkey";

-- DropForeignKey
ALTER TABLE "Hook" DROP CONSTRAINT "Hook_episodeId_fkey";

-- DropForeignKey
ALTER TABLE "FactClaim" DROP CONSTRAINT "FactClaim_storyId_fkey";

-- DropForeignKey
ALTER TABLE "FactClaim" DROP CONSTRAINT "FactClaim_episodeVersionId_fkey";

-- DropForeignKey
ALTER TABLE "Batch" DROP CONSTRAINT "Batch_characterId_fkey";

-- DropForeignKey
ALTER TABLE "CostEntry" DROP CONSTRAINT "CostEntry_characterId_fkey";

-- AlterTable
ALTER TABLE "Channel" DROP COLUMN "characterId",
DROP COLUMN "perspective";

-- AlterTable
ALTER TABLE "Story" DROP COLUMN "category",
DROP COLUMN "characterId",
DROP COLUMN "factMode",
DROP COLUMN "hasUnresolvedThreads",
DROP COLUMN "videoFormat";

-- AlterTable
ALTER TABLE "EpisodeVersion" DROP COLUMN "continuityReview",
DROP COLUMN "factCheckStatus",
DROP COLUMN "factReview";

-- AlterTable
ALTER TABLE "Batch" DROP COLUMN "autoSelect",
DROP COLUMN "category",
DROP COLUMN "characterId",
DROP COLUMN "mode";

-- AlterTable
ALTER TABLE "Concept" DROP COLUMN "category",
DROP COLUMN "factMode",
DROP COLUMN "totalScore";

-- AlterTable
ALTER TABLE "CostEntry" DROP COLUMN "characterId";

-- DropTable
DROP TABLE "Character";

-- DropTable
DROP TABLE "StoryBible";

-- DropTable
DROP TABLE "BibleUpdateProposal";

-- DropTable
DROP TABLE "VisualReference";

-- DropTable
DROP TABLE "Hook";

-- DropTable
DROP TABLE "FactClaim";

-- DropTable
DROP TABLE "ReferenceStory";

-- DropEnum
DROP TYPE "FactMode";

-- DropEnum
DROP TYPE "FactCheckStatus";

-- DropEnum
DROP TYPE "ClaimClassification";

-- DropEnum
DROP TYPE "ClaimStatus";

-- DropEnum
DROP TYPE "HookType";

-- DropEnum
DROP TYPE "BatchMode";

-- DropEnum
DROP TYPE "ProposalStatus";

-- DropEnum
DROP TYPE "NarrationPerspective";

