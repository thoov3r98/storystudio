-- Story quality pipeline: story seeds, version verdicts, ratings, retention metrics and reference stories.
ALTER TABLE "Story" ADD COLUMN "storySeed" JSONB;
ALTER TABLE "Concept" ADD COLUMN "storySeed" JSONB;
ALTER TABLE "PerformanceMetric" ADD COLUMN "earlyRetention" DOUBLE PRECISION;
ALTER TABLE "PerformanceMetric" ADD COLUMN "rewatchRate" DOUBLE PRECISION;
ALTER TABLE "EpisodeVersion" ADD COLUMN "qualityStatus" TEXT;
ALTER TABLE "EpisodeVersion" ADD COLUMN "humanRating" INTEGER;

CREATE TABLE "ReferenceStory" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "archetype" TEXT NOT NULL,
    "hookStyle" TEXT NOT NULL,
    "structure" TEXT NOT NULL DEFAULT '',
    "tone" TEXT NOT NULL DEFAULT '',
    "pacing" TEXT NOT NULL DEFAULT '',
    "endingType" TEXT NOT NULL DEFAULT '',
    "qualities" TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ReferenceStory_pkey" PRIMARY KEY ("id")
);
