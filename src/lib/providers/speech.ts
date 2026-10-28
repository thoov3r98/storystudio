import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { requireEnv } from "@/lib/env";
import type { CharAlignment } from "@/lib/timing";
import { getModels, type VoiceSettings } from "@/lib/settings";

export interface SpeechProvider {
  synthesize(args: { voiceId: string; text: string; settings: VoiceSettings }): Promise<{
    mp3: Buffer;
    alignment: CharAlignment;
    modelId: string;
  }>;
}

let client: ElevenLabsClient | undefined;

export function elevenlabs(): ElevenLabsClient {
  client ??= new ElevenLabsClient({ apiKey: requireEnv("ELEVENLABS_API_KEY", "narration") });
  return client;
}

/**
 * ElevenLabs text-to-speech with character-level timestamps. The alignment is
 * for the exact input text (not the normalised text), so scene boundaries can
 * be located by character offset.
 */
export const elevenLabsSpeechProvider: SpeechProvider = {
  async synthesize({ voiceId, text, settings }) {
    const modelId = (await getModels()).speech;
    const response = await elevenlabs().textToSpeech.convertWithTimestamps(
      voiceId,
      {
        text,
        modelId,
        outputFormat: "mp3_44100_128",
        voiceSettings: {
          stability: settings.stability,
          similarityBoost: settings.similarityBoost,
          style: settings.style,
          speed: settings.speed,
          useSpeakerBoost: settings.useSpeakerBoost,
        },
      },
      { timeoutInSeconds: 240, maxRetries: 2 },
    );
    const alignment = response.alignment ?? response.normalizedAlignment;
    if (!alignment) throw new Error("ElevenLabs returned no alignment data; cannot synchronise narration.");
    return {
      mp3: Buffer.from(response.audioBase64, "base64"),
      alignment: {
        characters: alignment.characters,
        characterStartTimesSeconds: alignment.characterStartTimesSeconds,
        characterEndTimesSeconds: alignment.characterEndTimesSeconds,
      },
      modelId,
    };
  },
};

export async function listElevenLabsVoices() {
  const res = await elevenlabs().voices.getAll({ showLegacy: false });
  return res.voices.map((v) => ({
    id: v.voiceId,
    name: v.name ?? v.voiceId,
    description: [v.labels?.accent, v.labels?.gender, v.labels?.age, v.labels?.description ?? v.labels?.descriptive].filter(Boolean).join(", "),
  }));
}
