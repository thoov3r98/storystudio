-- Opening tone switch per channel (off: the opening stays third person, like the rest).
ALTER TABLE "Channel" ADD COLUMN "looseOpening" BOOLEAN NOT NULL DEFAULT false;

-- Existing versions keep their landscape art and bands layout; new versions are square.
ALTER TABLE "EpisodeVersion" ADD COLUMN "imageShape" TEXT NOT NULL DEFAULT 'landscape';
ALTER TABLE "EpisodeVersion" ALTER COLUMN "imageShape" SET DEFAULT 'square';
ALTER TABLE "EpisodeVersion" ADD COLUMN "postCopy" JSONB;

-- The step shown on screen while a shot plays.
ALTER TABLE "Scene" ADD COLUMN "stepLabel" TEXT NOT NULL DEFAULT '';

-- How It's Made profile: two seeded sentences contradicted the writing rules (one or two numbers per
-- video; parts are one continuous story). Each is replaced only if the seeded wording is still there,
-- so a profile the producer has edited is left alone.
UPDATE "Channel"
SET "profile" = jsonb_set("profile", '{voice}', to_jsonb(replace("profile"->>'voice',
  'with real temperatures, speeds, quantities and times where the research gives them.',
  'with one or two striking numbers per video where the research gives them, said so they mean something.')))
WHERE "format" = 'PROCESS_EXPLAINER'
  AND "profile"->>'voice' LIKE '%with real temperatures, speeds, quantities and times where the research gives them.%';

UPDATE "Channel"
SET "profile" = jsonb_set("profile", '{structure}', to_jsonb(replace("profile"->>'structure',
  'Later parts open by naming the product and the stage they pick up from. Each part ends where the next stage begins, stated plainly.',
  'The parts are one continuous story cut into pieces: a later part carries straight on from the step before, without a recap, and each part ends on its last step without announcing the next.')))
WHERE "format" = 'PROCESS_EXPLAINER'
  AND "profile"->>'structure' LIKE '%Later parts open by naming the product and the stage they pick up from. Each part ends where the next stage begins, stated plainly.%';
