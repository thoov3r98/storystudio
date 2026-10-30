import { z } from "zod";

/**
 * Server environment. Each integration validates only the variables it needs,
 * at the moment it needs them, so a missing ElevenLabs key never breaks the
 * dashboard and the error names the exact variable to set.
 */
const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim().length > 0 ? v.trim() : undefined));

const EnvSchema = z.object({
  DATABASE_URL: optionalString,

  OPENAI_API_KEY: optionalString,
  OPENAI_TEXT_MODEL: z.string().default("gpt-5.5"),
  OPENAI_TEXT_MODEL_FAST: z.string().default("gpt-5.4-mini"),
  OPENAI_IMAGE_MODEL: z.string().default("gpt-image-2"),
  OPENAI_IMAGE_SIZE: z.string().default("1024x1536"),

  ELEVENLABS_API_KEY: optionalString,
  ELEVENLABS_MODEL_ID: z.string().default("eleven_multilingual_v2"),
  ELEVENLABS_DEFAULT_VOICE_ID: optionalString,

  BLOB_READ_WRITE_TOKEN: optionalString,

  TRIGGER_SECRET_KEY: optionalString,

  RENDER_PROVIDER: z.enum(["vercel-sandbox", "local"]).default("vercel-sandbox"),
  RENDER_API_SECRET: optionalString,
  STUDIO_APP_URL: optionalString,
  VERCEL_AUTOMATION_BYPASS_SECRET: optionalString,
  RENDER_SANDBOX_VCPUS: z.coerce.number().int().min(1).max(8).default(4),

  /** Optional: verified view counts for YouTube references (YouTube Data API v3). */
  YOUTUBE_API_KEY: optionalString,
});

export type Env = z.infer<typeof EnvSchema>;

let cached: Env | undefined;

export function env(): Env {
  if (!cached) cached = EnvSchema.parse(process.env);
  return cached;
}

export class MissingConfigError extends Error {
  constructor(public readonly variable: string, purpose: string) {
    super(`${variable} is not configured. It is required for ${purpose}. See README "Environment variables".`);
    this.name = "MissingConfigError";
  }
}

export function requireEnv<K extends keyof Env>(key: K, purpose: string): NonNullable<Env[K]> {
  const value = env()[key];
  if (value === undefined || value === null || value === "") {
    throw new MissingConfigError(String(key), purpose);
  }
  return value as NonNullable<Env[K]>;
}

/** Which integrations are configured, for the UI's setup checklist. No secrets are returned. */
export function integrationStatus() {
  const e = env();
  return {
    database: Boolean(e.DATABASE_URL),
    openai: Boolean(e.OPENAI_API_KEY),
    elevenlabs: Boolean(e.ELEVENLABS_API_KEY),
    blob: Boolean(e.BLOB_READ_WRITE_TOKEN),
    trigger: Boolean(e.TRIGGER_SECRET_KEY),
    render:
      e.RENDER_PROVIDER === "local" ||
      Boolean(e.RENDER_API_SECRET && e.STUDIO_APP_URL),
    renderProvider: e.RENDER_PROVIDER,
  };
}
