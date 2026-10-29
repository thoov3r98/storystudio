import { openai } from "./openai";
import type { TokenUsage } from "./structured";

export type ResearchSource = { url: string; title: string };

/** Provider seam for web research: the real implementation is OpenAI's web search tool; tests inject fakes. */
export interface ResearchClient {
  search(args: { model: string; system: string; user: string }): Promise<{ text: string; sources: ResearchSource[]; searches: number; usage: TokenUsage; model: string }>;
}

export const openAIResearchClient: ResearchClient = {
  async search({ model, system, user }) {
    const response = await openai().responses.create({
      model,
      tools: [{ type: "web_search" }],
      input: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    });
    const sources = new Map<string, ResearchSource>();
    let searches = 0;
    for (const item of response.output) {
      if (item.type === "web_search_call") searches++;
      if (item.type !== "message") continue;
      for (const part of item.content) {
        if (part.type !== "output_text") continue;
        for (const a of part.annotations) {
          if (a.type === "url_citation" && !sources.has(a.url)) sources.set(a.url, { url: a.url, title: a.title || a.url });
        }
      }
    }
    return {
      text: response.output_text,
      sources: [...sources.values()],
      searches,
      model: response.model ?? model,
      usage: {
        inputTokens: response.usage?.input_tokens ?? 0,
        cachedInputTokens: response.usage?.input_tokens_details?.cached_tokens ?? 0,
        outputTokens: response.usage?.output_tokens ?? 0,
      },
    };
  },
};
