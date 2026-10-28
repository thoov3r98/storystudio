import { openAIStructuredClient, type StructuredTextClient } from "@/lib/ai/structured-client";
import { openAIImageProvider, type ImageProvider } from "@/lib/providers/images";
import { elevenLabsSpeechProvider, type SpeechProvider } from "@/lib/providers/speech";
import { renderClient, type RenderClient } from "@/lib/render/client";

/** Provider seams for the pipeline. Production uses the real providers; tests pass fakes. */
export type PipelineDeps = {
  text: StructuredTextClient;
  images: ImageProvider;
  speech: SpeechProvider;
  /** Resolved lazily so RENDER_PROVIDER is read at run time. */
  render: () => RenderClient;
};

export const productionDeps: PipelineDeps = {
  text: openAIStructuredClient,
  images: openAIImageProvider,
  speech: elevenLabsSpeechProvider,
  render: renderClient,
};
