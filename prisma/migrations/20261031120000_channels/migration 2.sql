-- Channels: stories and batches belong to a TikTok channel, whose profile steers pitching, writing and checking.
-- CreateEnum
CREATE TYPE "ChannelFormat" AS ENUM ('CHARACTER_STORY', 'PROCESS_EXPLAINER');

-- AlterTable
ALTER TABLE "Story" ADD COLUMN     "channelId" TEXT,
ADD COLUMN     "research" JSONB;

-- AlterTable
ALTER TABLE "Batch" ADD COLUMN     "channelId" TEXT;

-- CreateTable
CREATE TABLE "Channel" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "brief" TEXT NOT NULL,
    "format" "ChannelFormat" NOT NULL,
    "profile" JSONB NOT NULL,
    "characterId" TEXT,
    "perspective" "NarrationPerspective" NOT NULL DEFAULT 'THIRD_PERSON',
    "voiceId" TEXT,
    "styleKey" TEXT NOT NULL DEFAULT 'stick-figure-color',
    "targetDurationSec" INTEGER NOT NULL DEFAULT 75,
    "minParts" INTEGER NOT NULL DEFAULT 3,
    "maxParts" INTEGER NOT NULL DEFAULT 5,
    "quality" "Quality" NOT NULL DEFAULT 'STANDARD',
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Channel_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Story_channelId_idx" ON "Story"("channelId");

-- AddForeignKey
ALTER TABLE "Channel" ADD CONSTRAINT "Channel_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Story" ADD CONSTRAINT "Story_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Batch" ADD CONSTRAINT "Batch_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- The studio is organised around TikTok channels. Stories made under the old topic
-- categories belong to no channel; they are archived (reversible from the library).
UPDATE "Story" SET "status" = 'ARCHIVED', "archivedAt" = CURRENT_TIMESTAMP WHERE "channelId" IS NULL AND "archivedAt" IS NULL;

-- The two launch channels. Kenny vs the World stars the existing Kenny character, if there is one.
INSERT INTO "Channel" ("id", "name", "brief", "format", "profile", "characterId", "perspective", "voiceId", "styleKey", "targetDurationSec", "minParts", "maxParts", "updatedAt")
VALUES (
  'channel-kenny-vs-the-world',
  'Kenny vs the World',
  'Stories of Kenny going through big apocalyptic scenarios (a zombie apocalypse, grocery stores running out of food, the electric grid shutting down) and how he faces the challenges and overcomes them. Engaging and descriptive, clear, with a good story arc. Matter-of-fact, not dramatic or sinister. No jumps or anything that confuses the viewer.',
  'CHARACTER_STORY',
  $json${
    "summary": "Kenny gets through the big what-if disasters people wonder about, one practical step at a time.",
    "subjects": "Big apocalyptic and disaster scenarios happening to an ordinary guy: a zombie outbreak, grocery stores running out of food, the power grid shutting down, the tap water stopping, a winter storm cutting the town off, the internet going down for good. The scenario is big; Kenny's response is practical and personal.",
    "voice": "An unseen narrator tells it in the third person, past tense: matter-of-fact and descriptive, like someone calmly recounting what a friend did. Engaging through a clear situation, concrete details and Kenny's practical choices. Never dramatic, sinister, ominous or horror-toned, even when the situation is dangerous: say what happened and what Kenny did about it. A light, dry observation about Kenny is fine; melodrama is not.",
    "structure": "One scenario told in strict time order across the parts. It opens plainly: where Kenny is and what has just happened. Each part covers one practical challenge (food, water, power, shelter, safety, getting somewhere, helping someone) and shows how Kenny works it out with what he has and knows. Each part ends on the next practical problem, stated plainly. The final part shows how Kenny comes through it. No flashbacks and no unexplained jumps: when time passes, say how much; when the place changes, say how Kenny got there; introduce every new person or object plainly before it matters.",
    "avoid": [
      "Horror imagery, gore, dread or ominous foreshadowing",
      "Part endings that are threats or mysteries instead of the next practical problem",
      "Jumps in time or place the viewer has to guess at",
      "Kenny solving things by luck, or with skills or items never mentioned before",
      "Long explanations of what caused the disaster",
      "Lessons, speeches or advice to the viewer"
    ],
    "surpriseMe": "Pick a big, well-known what-if disaster or apocalyptic scenario that anyone can picture instantly and that this channel hasn't covered yet. Vary the kind: infrastructure failures (power, water, internet, fuel), shortages (food, medicine), large natural disasters, and classic fiction scenarios (zombies, everyone vanishing).",
    "examples": [
      "The power grid goes down across the whole country",
      "Grocery stores run out of food",
      "A zombie outbreak starts in Kenny's city",
      "The tap water stops for a month",
      "A blizzard cuts Kenny's town off for two weeks"
    ]
  }$json$::jsonb,
  (SELECT "id" FROM "Character" WHERE lower("name") = 'kenny' ORDER BY "archivedAt" NULLS FIRST, "createdAt" LIMIT 1),
  'THIRD_PERSON',
  (SELECT "voiceId" FROM "Character" WHERE lower("name") = 'kenny' ORDER BY "archivedAt" NULLS FIRST, "createdAt" LIMIT 1),
  'stick-figure-color', 75, 3, 5, CURRENT_TIMESTAMP
), (
  'channel-how-its-made',
  'How It''s Made',
  'Just like the TV show How It''s Made, in the stick-figure style: how everyday products are made, step by step. An unseen narrator, strictly factual.',
  'PROCESS_EXPLAINER',
  $json${
    "summary": "How everyday products are made, step by step, like the TV show How It's Made, drawn as stick figures.",
    "subjects": "One manufactured product per series: everyday objects and foods people use without knowing how they are made (crayons, pencils, glass bottles, chocolate bars, sneakers, tennis balls, toothpaste). The real industrial process in a real factory.",
    "voice": "An unseen narrator, third person, present tense, calm and strictly factual, like the How It's Made narrator: what happens at each step, what the machine or worker does, what goes in and what comes out, with real temperatures, speeds, quantities and times where the research gives them. No jokes, puns, opinions, hype or drama, and never \"you\".",
    "structure": "The parts follow the real manufacturing order: raw materials, each major stage, then finishing, inspection and packing. Each part covers one or two stages from start to finish. Part 1 opens by saying plainly what the product is and where the process starts. Later parts open by naming the product and the stage they pick up from. Each part ends where the next stage begins, stated plainly. Every step follows the previous one in the order it happens in the factory.",
    "avoid": [
      "Numbers or facts that are not in the research",
      "Brand names and named companies",
      "History lessons or trivia that leave the factory floor",
      "Jokes, puns, hype words and rhetorical questions",
      "Skipping a step so a later one doesn't make sense"
    ],
    "surpriseMe": "Pick an everyday manufactured product most people use but have never seen made, with a clear, visual factory process of several stages, that this channel hasn't covered yet. Vary between foods, household items, toys, clothing and tools.",
    "examples": ["Crayons", "Glass bottles", "Tennis balls", "Pencils", "Chocolate bars"]
  }$json$::jsonb,
  NULL, 'THIRD_PERSON', NULL, 'stick-figure-color', 75, 3, 5, CURRENT_TIMESTAMP
);
