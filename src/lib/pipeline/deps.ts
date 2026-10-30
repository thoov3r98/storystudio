import { openAIStructuredClient, type StructuredTextClient } from "@/lib/ai/structured-client";
import { openAIResearchClient, type ResearchClient } from "@/lib/ai/research";
import { openAIImageProvider, type ImageProvider } from "@/lib/providers/images";
import { elevenLabsSpeechProvider, type SpeechProvider } from "@/lib/providers/speech";
import { elevenLabsSoundProvider, type SoundProvider } from "@/lib/providers/sound";
import { renderClient, type RenderClient } from "@/lib/render/client";

/** Provider seams for the pipeline. Production uses the real providers; tests pass fakes. */
export type PipelineDeps = {
  text: StructuredTextClient;
  /** Web research for process explainers. */
  research: ResearchClient;
  images: ImageProvider;
  speech: SpeechProvider;
  /** Sound effects and the default music bed, each generated once for the audio library. */
  sound: SoundProvider;
  /** Resolved lazily so RENDER_PROVIDER is read at run time. */
  render: () => RenderClient;
};

export const productionDeps: PipelineDeps = {
  text: openAIStructuredClient,
  research: openAIResearchClient,
  images: openAIImageProvider,
  speech: elevenLabsSpeechProvider,
  sound: elevenLabsSoundProvider,
  render: renderClient,
};
