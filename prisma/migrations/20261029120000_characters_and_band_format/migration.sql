-- CreateEnum
CREATE TYPE "NarrationPerspective" AS ENUM ('FIRST_PERSON', 'THIRD_PERSON');

-- AlterTable
-- Existing stories were illustrated full-frame portrait; keep them that way. New stories default to bands.
ALTER TABLE "Story" ADD COLUMN     "characterId" TEXT,
ADD COLUMN     "videoFormat" TEXT NOT NULL DEFAULT 'full';
ALTER TABLE "Story" ALTER COLUMN "videoFormat" SET DEFAULT 'bands';

-- AlterTable
ALTER TABLE "Batch" ADD COLUMN     "characterId" TEXT;

-- AlterTable
ALTER TABLE "CostEntry" ADD COLUMN     "characterId" TEXT;

-- CreateTable
CREATE TABLE "Character" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tagline" TEXT NOT NULL,
    "brief" TEXT NOT NULL,
    "personality" TEXT NOT NULL,
    "backstory" TEXT NOT NULL,
    "speakingStyle" TEXT NOT NULL,
    "visualDescription" TEXT NOT NULL,
    "signatureColor" TEXT NOT NULL DEFAULT '#E0362C',
    "perspective" "NarrationPerspective" NOT NULL DEFAULT 'FIRST_PERSON',
    "voiceId" TEXT,
    "sheetUrl" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Character_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Story" ADD CONSTRAINT "Story_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Batch" ADD CONSTRAINT "Batch_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostEntry" ADD CONSTRAINT "CostEntry_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE SET NULL ON UPDATE CASCADE;

