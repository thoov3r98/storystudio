import { toFile } from "openai";
import { z } from "zod";
import { zodTextFormat } from "openai/helpers/zod";
import { openai } from "@/lib/ai/openai";
import { imageReviewPrompt } from "@/lib/ai/prompts";
import { env } from "@/lib/env";
import { SAFE_AREA_RULE, styleSpec } from "@/lib/constants";

export type ImageUsage = { textInputTokens: number; imageInputTokens: number; outputTokens: number };

export interface ImageProvider {
  generate(args: { prompt: string; quality: "low" | "medium" | "high"; references: Buffer[]; signal?: AbortSignal }): Promise<{
    png: Buffer;
    model: string;
    usage: ImageUsage | null;
    usedReference: boolean;
  }>;
}

/** Builds the final prompt from the global style spec, story visual notes and the scene. */
export function buildImagePrompt(input: {
  styleKey: string;
  scene: { imagePrompt: string; composition: string; characters: string[]; objects: string[] };
  characterSheet: { name: string; visualDescription: string }[];
  visualNotes?: string;
  hasReference: boolean;
}): string {
  const chars = input.scene.characters
    .map((name) => input.characterSheet.find((c) => c.name.toLowerCase() === name.toLowerCase()))
    .filter((c): c is { name: string; visualDescription: string } => Boolean(c))
    .map((c) => `${c.name}: ${c.visualDescription}`);
  return [
    `STYLE: ${styleSpec(input.styleKey)}`,
    input.hasReference ? "Match the line weight, figure proportions and overall drawing style of the reference image(s) exactly; do not copy their content." : "",
    input.visualNotes ? `SERIES VISUAL NOTES: ${input.visualNotes}` : "",
    `SCENE: ${input.scene.imagePrompt}`,
    `COMPOSITION: ${input.scene.composition}. ${SAFE_AREA_RULE}`,
    chars.length ? `CHARACTERS (draw consistently): ${chars.join(" | ")}` : "",
    input.scene.objects.length ? `KEY OBJECTS: ${input.scene.objects.join(", ")}` : "",
    "Absolutely no text, words, letters, numbers, signage, logos or watermarks.",
  ]
    .filter(Boolean)
    .join("\n");
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
  async generate({ prompt, quality, references, signal }) {
    const { OPENAI_IMAGE_MODEL: model, OPENAI_IMAGE_SIZE: size } = env();
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
};

export const ImageReviewSchema = z.object({
  pass: z.boolean(),
  containsText: z.boolean(),
  styleViolations: z.array(z.string()),
  matchesScene: z.boolean(),
  notes: z.string(),
});
export type ImageReview = z.infer<typeof ImageReviewSchema>;

/** Optional vision check for text/style violations. Returns null if the review itself fails. */
export async function reviewImage(png: Buffer, sceneDescription: string, model: string) {
  try {
    const response = await openai().responses.parse({
      model,
      input: [
        {
          role: "user",
          content: [
            { type: "input_text", text: imageReviewPrompt(sceneDescription) },
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
