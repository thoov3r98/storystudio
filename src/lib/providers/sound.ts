import { elevenlabs } from "./speech";

export interface SoundProvider {
  /** A short sound effect; `loop` makes it seamless so it can run under a whole shot. */
  effect(args: { prompt: string; durationSeconds: number; loop: boolean }): Promise<{ mp3: Buffer; model: string }>;
  /** An instrumental music track. */
  music(args: { prompt: string; lengthMs: number }): Promise<{ mp3: Buffer; model: string }>;
}

const SFX_MODEL = "eleven_text_to_sound_v2";
const MUSIC_MODEL = "music_v1";

async function toBuffer(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  return Buffer.from(await new Response(stream).arrayBuffer());
}

/** ElevenLabs sound effects and music, on the same account as the narration. */
export const elevenLabsSoundProvider: SoundProvider = {
  async effect({ prompt, durationSeconds, loop }) {
    const stream = await elevenlabs().textToSoundEffects.convert(
      { text: prompt, durationSeconds, loop, promptInfluence: 0.5, modelId: SFX_MODEL, outputFormat: "mp3_44100_128" },
      { timeoutInSeconds: 120, maxRetries: 2 },
    );
    return { mp3: await toBuffer(stream), model: SFX_MODEL };
  },
  async music({ prompt, lengthMs }) {
    const stream = await elevenlabs().music.compose(
      { prompt, musicLengthMs: lengthMs, forceInstrumental: true, modelId: MUSIC_MODEL, outputFormat: "mp3_44100_128" },
      { timeoutInSeconds: 300, maxRetries: 1 },
    );
    return { mp3: await toBuffer(stream), model: MUSIC_MODEL };
  },
};
