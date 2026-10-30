-- Each shot can carry a factory sound effect; generated audio is keyed for reuse.
ALTER TABLE "Scene" ADD COLUMN "soundEffect" TEXT NOT NULL DEFAULT 'none';

ALTER TABLE "AudioAsset" ADD COLUMN "key" TEXT;
CREATE UNIQUE INDEX "AudioAsset_key_key" ON "AudioAsset"("key");
