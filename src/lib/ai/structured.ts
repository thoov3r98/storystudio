import type { z } from "zod";
import { recordCost, type CostContext } from "@/lib/costs/record";
import { textCost, type Pricing } from "@/lib/costs/pricing";

export type TokenUsage = { inputTokens: number; cachedInputTokens: number; outputTokens: number };

/** Provider seam: the real implementation is OpenAI; tests inject fakes. */
export interface StructuredTextClient {
  generate<S extends z.ZodType>(args: {
    model: string;
    system: string;
    user: string;
    schema: S;
    schemaName: string;
  }): Promise<{ parsed: unknown; usage: TokenUsage; model: string; refusal?: string | null }>;
}

export class StructuredOutputError extends Error {
  constructor(
    public readonly schemaName: string,
    public readonly attempts: { attempt: number; issues: string[] }[],
  ) {
    super(
      `The model did not return a valid "${schemaName}" after ${attempts.length} attempt(s). Last issues: ${attempts.at(-1)?.issues.slice(0, 5).join("; ")}`,
    );
    this.name = "StructuredOutputError";
  }

  toJSON() {
    return { name: this.name, message: this.message, schemaName: this.schemaName, attempts: this.attempts };
  }
}

export type GenerateStructuredArgs<S extends z.ZodType> = {
  client: StructuredTextClient;
  pricing: Pricing;
  model: string;
  system: string;
  user: string;
  schema: S;
  schemaName: string;
  /** Semantic checks beyond the schema (ranges, counts, cross-field rules). Return human-readable issues. */
  validate?: (value: z.infer<S>) => string[];
  maxAttempts?: number;
  cost?: { ctx: CostContext; operation: string };
};

/**
 * Calls the model with a strict JSON schema, validates with Zod and optional
 * semantic checks, and retries (bounded) with the validation issues fed back.
 */
export async function generateStructured<S extends z.ZodType>(args: GenerateStructuredArgs<S>): Promise<z.infer<S>> {
  const maxAttempts = args.maxAttempts ?? 3;
  const attempts: { attempt: number; issues: string[] }[] = [];
  let feedback = "";

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const user = feedback
      ? `${args.user}\n\n---\nYour previous response was rejected for these reasons. Fix every issue and return the complete object again:\n${feedback}`
      : args.user;

    const result = await args.client.generate({ model: args.model, system: args.system, user, schema: args.schema, schemaName: args.schemaName });

    if (args.cost) {
      await recordCost(args.cost.ctx, {
        provider: "OPENAI_TEXT",
        model: result.model,
        operation: args.cost.operation,
        usage: { ...result.usage, attempt },
        costUsd: textCost(args.pricing, result.model, result.usage),
        estimated: false,
      });
    }

    if (result.refusal) {
      attempts.push({ attempt, issues: [`Model refused: ${result.refusal}`] });
      feedback = "The request is for harmless educational storytelling. Please complete it.";
      continue;
    }

    const parsed = args.schema.safeParse(result.parsed);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
      attempts.push({ attempt, issues });
      feedback = issues.map((i) => `- ${i}`).join("\n");
      continue;
    }

    const semantic = args.validate?.(parsed.data) ?? [];
    if (semantic.length > 0) {
      attempts.push({ attempt, issues: semantic });
      feedback = semantic.map((i) => `- ${i}`).join("\n");
      continue;
    }

    return parsed.data;
  }

  throw new StructuredOutputError(args.schemaName, attempts);
}
