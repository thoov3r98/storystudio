import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { requireEnv } from "@/lib/env";
import type { StructuredTextClient } from "./structured";

let client: OpenAI | undefined;

export function openai(): OpenAI {
  client ??= new OpenAI({
    apiKey: requireEnv("OPENAI_API_KEY", "story writing and illustration"),
    timeout: 180_000,
    maxRetries: 2,
  });
  return client;
}

export const openAIStructuredClient: StructuredTextClient = {
  async generate({ model, system, user, schema, schemaName }) {
    const response = await openai().responses.parse({
      model,
      input: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      text: { format: zodTextFormat(schema, schemaName) },
    });

    let refusal: string | null = null;
    for (const item of response.output) {
      if (item.type === "message") {
        for (const part of item.content) {
          if (part.type === "refusal") refusal = part.refusal;
        }
      }
    }

    return {
      parsed: response.output_parsed,
      refusal,
      model: response.model ?? model,
      usage: {
        inputTokens: response.usage?.input_tokens ?? 0,
        cachedInputTokens: response.usage?.input_tokens_details?.cached_tokens ?? 0,
        outputTokens: response.usage?.output_tokens ?? 0,
      },
    };
  },
};
