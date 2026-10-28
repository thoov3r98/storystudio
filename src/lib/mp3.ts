/*
 * Minimal MPEG audio frame scanner. Used to measure the real duration of the
 * generated voiceover without decoding audio or shelling out to ffprobe.
 */

const BITRATES: Record<string, number[]> = {
  // [version][layer] tables (kbps), index 0 = free, 15 = bad
  "1-3": [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, -1],
  "2-3": [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, -1],
};

const SAMPLE_RATES: Record<number, number[]> = {
  3: [44100, 48000, 32000], // MPEG1
  2: [22050, 24000, 16000], // MPEG2
  0: [11025, 12000, 8000], // MPEG2.5
};

function skipId3(buf: Uint8Array): number {
  if (buf.length >= 10 && buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) {
    const size = ((buf[6] & 0x7f) << 21) | ((buf[7] & 0x7f) << 14) | ((buf[8] & 0x7f) << 7) | (buf[9] & 0x7f);
    const footer = buf[5] & 0x10 ? 10 : 0;
    return 10 + size + footer;
  }
  return 0;
}

/** Returns duration in milliseconds, or null if no valid MPEG Layer III frames were found. */
export function mp3DurationMs(input: Uint8Array): number | null {
  let offset = skipId3(input);
  let totalSamples = 0;
  let sampleRate = 0;
  let frames = 0;

  while (offset + 4 <= input.length) {
    if (input[offset] !== 0xff || (input[offset + 1] & 0xe0) !== 0xe0) {
      offset++;
      continue;
    }
    const versionBits = (input[offset + 1] >> 3) & 0x03; // 3=MPEG1, 2=MPEG2, 0=MPEG2.5
    const layerBits = (input[offset + 1] >> 1) & 0x03; // 1=Layer III
    const bitrateIdx = (input[offset + 2] >> 4) & 0x0f;
    const srIdx = (input[offset + 2] >> 2) & 0x03;
    const padding = (input[offset + 2] >> 1) & 0x01;

    if (versionBits === 1 || layerBits !== 1 || bitrateIdx === 0 || bitrateIdx === 15 || srIdx === 3) {
      offset++;
      continue;
    }
    const isV1 = versionBits === 3;
    const bitrate = BITRATES[isV1 ? "1-3" : "2-3"][bitrateIdx] * 1000;
    const sr = SAMPLE_RATES[versionBits][srIdx];
    const samplesPerFrame = isV1 ? 1152 : 576;
    const frameLength = Math.floor(((isV1 ? 144 : 72) * bitrate) / sr) + padding;
    if (frameLength <= 4) {
      offset++;
      continue;
    }
    totalSamples += samplesPerFrame;
    sampleRate = sr;
    frames++;
    offset += frameLength;
  }

  if (frames === 0 || sampleRate === 0) return null;
  return Math.round((totalSamples / sampleRate) * 1000);
}
