import { db } from "@/lib/db";
import { generateStructured } from "@/lib/ai/structured";
import { characterPrompt, characterSheetPrompt, type NarratorProfile } from "@/lib/ai/prompts";
import { CharacterProfileSchema } from "@/lib/schemas/character";
import { imageCost } from "@/lib/costs/pricing";
import { recordCost } from "@/lib/costs/record";
import { DEFAULT_STYLE, VIDEO_FORMATS } from "@/lib/constants";
import { getModels, getPricing } from "@/lib/settings";
import { uploadAsset } from "@/lib/storage";
import { withTimeout } from "@/lib/async";
import type { Character } from "@/generated/prisma/client";
import type { StoryBible } from "@/lib/schemas/story-bible";
import type { PipelineDeps } from "./deps";

export function toNarrator(c: Character): NarratorProfile {
  return { name: c.name, perspective: c.perspective, tagline: c.tagline, personality: c.personality, backstory: c.backstory, speakingStyle: c.speakingStyle };
}

/** Seeds a new story's bible with its series character so every episode and image starts from them. */
export function withCharacter(bible: StoryBible, c: Character): StoryBible {
  return {
    ...bible,
    tone: "Warm, grounded and suspenseful, carried by the narrator's personality.",
    narrativePerspective:
      c.perspective === "FIRST_PERSON" ? `First person, past tense, narrated by ${c.name}.` : `Close third person, past tense, following ${c.name}.`,
    characters: [
      { name: c.name, role: "Narrator and hero", description: `${c.tagline}. ${c.personality}`, visualDescription: c.visualDescription, firstAppearedPart: 1 },
      ...bible.characters.filter((x) => x.name.toLowerCase() !== c.name.toLowerCase()),
    ],
    visualStyle: { ...bible.visualStyle, notes: `${c.name} always wears their signature ${c.signatureColor} item. ${bible.visualStyle.notes}`.trim() },
  };
}

/** Designs a character from a one-line brief and saves it (no image yet). */
export async function createCharacterFromBrief(input: { brief: string; deps: PipelineDeps }): Promise<Character> {
  const [pricing, models, existing] = await Promise.all([getPricing(), getModels(), db.character.findMany({ where: { archivedAt: null }, select: { name: true } })]);
  // Created first so the design cost is attributed to it; removed again if design fails.
  const draft = await db.character.create({
    data: { name: "New character", tagline: "", brief: input.brief, personality: "", backstory: "", speakingStyle: "", visualDescription: "" },
  });
  const profile = await generateStructured({
    client: input.deps.text,
    pricing,
    model: models.main,
    ...characterPrompt({ brief: input.brief, existingNames: existing.map((c) => c.name) }),
    schema: CharacterProfileSchema,
    schemaName: "character_profile",
    validate: (v) => (/^#[0-9a-fA-F]{6}$/.test(v.signatureColor) ? [] : ["signatureColor must be a hex colour like #E0362C."]),
    cost: { ctx: { characterId: draft.id }, operation: "character-profile" },
  }).catch(async (err) => {
    await db.character.delete({ where: { id: draft.id } }).catch(() => {});
    throw err;
  });
  return db.character.update({ where: { id: draft.id }, data: profile });
}

/** Draws (or redraws) the character reference sheet used by every scene illustration. */
export async function drawCharacterSheet(input: { characterId: string; deps: PipelineDeps }): Promise<string> {
  const character = await db.character.findUniqueOrThrow({ where: { id: input.characterId } });
  const pricing = await getPricing();
  const prompt = characterSheetPrompt({ ...character, styleKey: DEFAULT_STYLE });
  const result = await withTimeout("Character sheet", 4 * 60_000, (signal) =>
    input.deps.images.generate({ prompt, quality: "medium", references: [], size: VIDEO_FORMATS.bands.imageSize, signal }),
  );
  const cost = imageCost(pricing, "medium", result.usage);
  await recordCost({ characterId: character.id }, { provider: "OPENAI_IMAGE", model: result.model, operation: "character-sheet", usage: { ...(result.usage ?? {}) }, ...cost });
  const uploaded = await uploadAsset(`characters/${character.id}/sheet-${Date.now()}.png`, result.png, "image/png");
  await db.character.update({ where: { id: character.id }, data: { sheetUrl: uploaded.url } });
  return uploaded.url;
}
