import { describe, expect, it } from "vitest";
import { mp3DurationMs } from "@/lib/mp3";

/** Builds a CBR MPEG-1 Layer III stream: 128 kbps, 44.1 kHz (ElevenLabs mp3_44100_128). */
function cbrStream(frames: number, withId3 = false): Uint8Array {
  const frameLen = Math.floor((144 * 128_000) / 44_100); // 417 bytes, no padding
  const parts: number[] = [];
  if (withId3) {
    // "ID3" v2.3 header with a 20-byte syncsafe size, then 20 bytes of tag data.
    parts.push(0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0, 20, ...new Array(20).fill(0));
  }
  for (let i = 0; i < frames; i++) {
    const frame = new Array(frameLen).fill(0);
    frame[0] = 0xff;
    frame[1] = 0xfb; // MPEG-1, Layer III, no CRC
    frame[2] = 0x90; // bitrate index 9 (128k), 44.1 kHz, no padding
    frame[3] = 0x64;
    parts.push(...frame);
  }
  return Uint8Array.from(parts);
}

describe("mp3DurationMs", () => {
  it("measures duration from frame count", () => {
    // 1000 frames × 1152 samples / 44100 Hz = 26.122 s
    expect(mp3DurationMs(cbrStream(1000))).toBe(26122);
  });

  it("skips an ID3v2 tag", () => {
    expect(mp3DurationMs(cbrStream(100, true))).toBe(2612);
  });

  it("returns null for non-MP3 data", () => {
    expect(mp3DurationMs(new Uint8Array(500))).toBeNull();
  });
});
