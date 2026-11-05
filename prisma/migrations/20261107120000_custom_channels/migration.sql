-- New channels no longer pick a preset: they share one neutral base, steered by what the producer writes (src/lib/ai/channel-styles.ts).
ALTER TYPE "ChannelFormat" ADD VALUE 'CUSTOM';
