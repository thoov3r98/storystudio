import { toFile } from "openai";
import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import { openai } from "@/lib/ai/openai";
import type { TokenUsage } from "@/lib/ai/structured";
import type { VisualState } from "@/lib/schemas/episode";
import { env } from "@/lib/env";
import { getModels } from "@/lib/settings";
import { styleSpec, VIDEO_FORMATS, type VideoFormat } from "@/lib/constants";

export type ImageUsage = { textInputTokens: number; imageInputTokens: number; outputTokens: number };

export interface ImageProvider {
  /** `size` defaults to OPENAI_IMAGE_SIZE. */
  generate(args: { prompt: string; quality: "low" | "medium" | "high"; references: Buffer[]; size?: string; signal?: AbortSignal }): Promise<{
    png: Buffer;
    model: string;
    usage: ImageUsage | null;
    usedReference: boolean;
  }>;
  /** Vision check of a finished image against what the shot must show. Null if the check itself fails. */
  review(args: { png: Buffer; prompt: string; model: string }): Promise<{ review: ImageReview | null; usage: TokenUsage; model: string } | null>;
}

/** The story around a shot, so each illustration shows that exact moment and agrees with the others. */
export type ShotContext = {
  summary: string;
  visualState?: VisualState | null;
  narration: string;
  previous?: string | null;
  next?: string | null;
  continuity?: string | null;
};

/** Builds the final prompt from the global style spec, story visual notes and the scene. */
export function buildImagePrompt(input: {
  styleKey: string;
  scene: { imagePrompt: string; composition: string; characters: string[]; objects: string[] };
  characterSheet: { name: string; visualDescription: string }[];
  visualNotes?: string;
  hasReference: boolean;
  format?: VideoFormat;
  /** The series' recurring character; the first reference image is their character sheet. */
  hero?: { name: string; visualDescription: string } | null;
  /** The hero's name when they are NOT in this shot, so the model leaves them out. */
  absentHero?: string | null;
  shot?: ShotContext | null;
  /** Problems with a rejected earlier attempt, to fix this time. */
  fix?: string[];
}): string {
  const chars = input.scene.characters
    .map((name) => input.characterSheet.find((c) => c.name.toLowerCase() === name.toLowerCase()))
    .filter((c): c is { name: string; visualDescription: string } => Boolean(c))
    .map((c) => `${c.name}: ${c.visualDescription}`);
  return [
    `STYLE: ${styleSpec(input.styleKey)}`,
    input.hero && input.hasReference
      ? `The first reference image is the character sheet for ${input.hero.name}. Whenever ${input.hero.name} appears, draw them exactly as on that sheet: same build, clothing, colours and props. Match the drawing style of all reference images; do not copy their layout or poses.`
      : input.hasReference
        ? "Match the line weight, figure proportions and overall drawing style of the reference image(s) exactly; do not copy their content."
        : "",
    input.visualNotes ? `SERIES VISUAL NOTES: ${input.visualNotes}` : "",
    ...shotLines(input.shot),
    `SCENE: ${input.scene.imagePrompt}`,
    `COMPOSITION: ${input.scene.composition}. ${VIDEO_FORMATS[input.format ?? "full"].safeArea}`,
    chars.length ? `CHARACTERS (draw consistently): ${chars.join(" | ")}` : "",
    input.scene.objects.length ? `KEY OBJECTS: ${input.scene.objects.join(", ")}` : "",
    input.shot ? "Draw exactly the moment of THIS MOMENT, true to the episode facts and continuity. Only the characters listed appear." : "",
    input.shot
      ? "Keep the STYLE's palette and light background in every shot. Show time of day and weather with small cues only (sun position, a pale tint in the sky, lit windows, long shadows, falling snow); never wash the whole image in a colour."
      : "",
    input.absentHero ? `${input.absentHero} is not in this shot.` : "",
    input.fix?.length ? `A previous attempt was rejected. Fix these problems: ${input.fix.join("; ")}` : "",
    "Absolutely no text, words, letters, numbers, signage, logos or watermarks.",
  ]
    .filter(Boolean)
    .join("\n");
}

function shotLines(shot: ShotContext | null | undefined): string[] {
  if (!shot) return [];
  const v = shot.visualState;
  return [
    `EPISODE: ${shot.summary}`,
    v
      ? `EPISODE FACTS (true in every shot): Setting: ${v.setting}. Time and light: ${v.timeAndLight}. Weather: ${v.weather}. Hero: ${v.heroSituation}. Hero's look: ${v.heroLook}.${v.rules.length ? ` Rules: ${v.rules.join("; ")}.` : ""}`
      : "",
    shot.previous ? `PREVIOUS MOMENT: "${shot.previous}"` : "",
    `THIS MOMENT (narrated over this image): "${shot.narration}"`,
    shot.next ? `NEXT MOMENT: "${shot.next}"` : "",
    shot.continuity ? `CONTINUITY: ${shot.continuity}` : "",
  ].filter(Boolean);
}

function readUsage(usage: unknown): ImageUsage | null {
  const u = usage as
    | { input_tokens_details?: { text_tokens?: number; image_tokens?: number }; output_tokens?: number; input_tokens?: number }
    | undefined;
  if (!u || typeof u.output_tokens !== "number") return null;
  return {
    textInputTokens: u.input_tokens_details?.text_tokens ?? u.input_tokens ?? 0,
    imageInputTokens: u.input_tokens_details?.image_tokens ?? 0,
    outputTokens: u.output_tokens,
  };
}

export const openAIImageProvider: ImageProvider = {
  async generate({ prompt, quality, references, size: requestedSize, signal }) {
    const model = (await getModels()).image;
    const size = (requestedSize ?? env().OPENAI_IMAGE_SIZE) as "1024x1536";
    const common = { model, prompt, size, quality, n: 1 } as const;

    const response =
      references.length > 0
        ? await openai().images.edit(
            {
              ...common,
              image: await Promise.all(references.slice(0, 4).map((buf, i) => toFile(buf, `reference-${i}.png`, { type: "image/png" }))),
              background: "opaque",
              output_format: "png",
            },
            { signal, timeout: 240_000 },
          )
        : await openai().images.generate({ ...common, background: "opaque", output_format: "png" }, { signal, timeout: 240_000 });

    const b64 = response.data?.[0]?.b64_json;
    if (!b64) throw new Error("Image API returned no image data.");
    return { png: Buffer.from(b64, "base64"), model, usage: readUsage(response.usage), usedReference: references.length > 0 };
  },
  review: ({ png, prompt, model }) => reviewImage(png, prompt, model),
};

export const ImageReviewSchema = z.object({
  pass: z.boolean(),
  containsText: z.boolean(),
  styleViolations: z.array(z.string()),
  matchesScene: z.boolean(),
  notes: z.string(),
});
export type ImageReview = z.infer<typeof ImageReviewSchema>;

/** Vision check against the shot's requirements. Returns null if the review itself fails. */
async function reviewImage(png: Buffer, reviewPrompt: string, model: string) {
  try {
    const response = await openai().responses.parse({
      model,
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: reviewPrompt },
            { type: "input_image", image_url: `data:image/png;base64,${png.toString("base64")}`, detail: "low" },
          ],
        },
      ],
      text: { format: zodTextFormat(ImageReviewSchema, "image_review") },
    });
    return {
      review: response.output_parsed,
      usage: {
        inputTokens: response.usage?.input_tokens ?? 0,
        cachedInputTokens: response.usage?.input_tokens_details?.cached_tokens ?? 0,
        outputTokens: response.usage?.output_tokens ?? 0,
      },
      model: response.model ?? model,
    };
  } catch {
    return null;
  }
}
