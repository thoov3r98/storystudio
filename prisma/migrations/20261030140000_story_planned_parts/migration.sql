-- One story planned across several videos (Part 1..N). Existing stories stay single-part.
ALTER TABLE "Story" ADD COLUMN "plannedParts" INTEGER NOT NULL DEFAULT 1;
