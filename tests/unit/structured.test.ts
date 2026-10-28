import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { generateStructured, StructuredOutputError, type StructuredTextClient } from "@/lib/ai/structured";
import { DEFAULT_PRICING } from "@/lib/costs/pricing";

const Schema = z.object({ items: z.array(z.object({ score: z.number() })) });

function scriptedClient(outputs: unknown[]): StructuredTextClient & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async generate({ user }) {
      calls.push(user);
      const parsed = outputs[Math.min(calls.length - 1, outputs.length - 1)];
      return { parsed, model: "test-model", usage: { inputTokens: 10, cachedInputTokens: 0, outputTokens: 5 } };
    },
  };
}

describe("generateStructured", () => {
  it("returns valid output on the first attempt", async () => {
    const client = scriptedClient([{ items: [{ score: 5 }] }]);
    const out = await generateStructured({ client, pricing: DEFAULT_PRICING, model: "m", system: "s", user: "u", schema: Schema, schemaName: "t" });
    expect(out.items[0].score).toBe(5);
    expect(client.calls).toHaveLength(1);
  });

  it("retries with schema errors fed back to the model", async () => {
    const client = scriptedClient([{ items: "nope" }, { items: [{ score: 7 }] }]);
    const out = await generateStructured({ client, pricing: DEFAULT_PRICING, model: "m", system: "s", user: "u", schema: Schema, schemaName: "t" });
    expect(out.items[0].score).toBe(7);
    expect(client.calls[1]).toContain("previous response was rejected");
    expect(client.calls[1]).toContain("items");
  });

  it("retries on semantic validation failures", async () => {
    const client = scriptedClient([{ items: [{ score: 42 }] }, { items: [{ score: 9 }] }]);
    const validate = vi.fn((v: z.infer<typeof Schema>) => (v.items.some((i) => i.score > 10) ? ["score must be 1-10"] : []));
    const out = await generateStructured({ client, pricing: DEFAULT_PRICING, model: "m", system: "s", user: "u", schema: Schema, schemaName: "t", validate });
    expect(out.items[0].score).toBe(9);
    expect(client.calls[1]).toContain("score must be 1-10");
  });

  it("gives up after bounded attempts with a structured error", async () => {
    const client = scriptedClient([{ wrong: true }]);
    const err = await generateStructured({ client, pricing: DEFAULT_PRICING, model: "m", system: "s", user: "u", schema: Schema, schemaName: "concept_batch", maxAttempts: 2 }).catch((e) => e);
    expect(err).toBeInstanceOf(StructuredOutputError);
    expect(err.attempts).toHaveLength(2);
    expect(err.toJSON()).toMatchObject({ schemaName: "concept_batch" });
    expect(client.calls).toHaveLength(2);
  });
});
