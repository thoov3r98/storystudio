import { describe, expect, it } from "vitest";
import { alignmentToWords, buildEpisodeTiming, type CharAlignment, sceneTimingsFromAlignment, wordsToCaptions, measuredWordsPerSecond } from "@/lib/timing";

/**
 * Builds a character alignment with deliberately uneven pacing: each word gets
 * its own duration and every sentence ends with a pause, the way real TTS does.
 */
function fakeAlignment(text: string): CharAlignment {
  const characters: string[] = [];
  const starts: number[] = [];
  const ends: number[] = [];
  let t = 0.1;
  let wordIndex = 0;
  for (const ch of text) {
    if (ch === " ") {
      characters.push(ch);
      starts.push(t);
      t += 0.04;
      ends.push(t);
      wordIndex++;
      continue;
    }
    const perChar = 0.05 + (wordIndex % 3) * 0.02;
    characters.push(ch);
    starts.push(t);
    t += perChar;
    ends.push(t);
    if (ch === ".") t += 0.5;
  }
  return { characters, characterStartTimesSeconds: starts, characterEndTimesSeconds: ends };
}

const scenes = [
  { sceneNumber: 1, narration: "You land after ten hours." },
  { sceneNumber: 2, narration: "The carousel stops, and your bag is gone." },
  { sceneNumber: 3, narration: "It is already two airports away." },
];
const text = scenes.map((s) => s.narration).join(" ");

describe("alignmentToWords", () => {
  it("groups characters into words using real start/end times", () => {
    const a = fakeAlignment(text);
    const words = alignmentToWords(a);
    expect(words.map((w) => w.text)).toEqual(text.split(" "));
    expect(words[0].startMs).toBe(100);
    for (let i = 1; i < words.length; i++) expect(words[i].startMs).toBeGreaterThan(words[i - 1].endMs - 1);
  });

  it("does not space words evenly", () => {
    const words = alignmentToWords(fakeAlignment(text));
    const durations = words.map((w) => w.endMs - w.startMs);
    expect(new Set(durations).size).toBeGreaterThan(3);
  });

  it("rejects malformed alignment", () => {
    expect(() => alignmentToWords({ characters: ["a"], characterStartTimesSeconds: [], characterEndTimesSeconds: [0] })).toThrow(/mismatched/);
  });
});

describe("sceneTimingsFromAlignment", () => {
  it("starts each scene when its first character is spoken and chains scenes back to back", () => {
    const a = fakeAlignment(text);
    const timings = sceneTimingsFromAlignment(scenes, a, 9000);
    expect(timings[0].startMs).toBe(0);
    expect(timings.at(-1)!.endMs).toBe(9000);
    for (let i = 1; i < timings.length; i++) expect(timings[i].startMs).toBe(timings[i - 1].endMs);
    const scene2Char = text.indexOf("The carousel");
    expect(timings[1].startMs).toBe(Math.round(a.characterStartTimesSeconds[scene2Char] * 1000));
  });

  it("throws if a scene cannot be located", () => {
    expect(() => sceneTimingsFromAlignment([{ sceneNumber: 1, narration: "Nothing like this" }], fakeAlignment(text), 1000)).toThrow(/scene 1/);
  });
});

describe("wordsToCaptions", () => {
  it("keeps phrases short and breaks after punctuation", () => {
    const captions = wordsToCaptions(alignmentToWords(fakeAlignment(text)));
    for (const c of captions) {
      expect(c.words.length).toBeLessThanOrEqual(4);
      expect(c.startMs).toBe(c.words[0].startMs);
    }
    expect(captions.some((c) => c.text.endsWith("hours."))).toBe(true);
    expect(captions.map((c) => c.text).join(" ")).toBe(text);
  });
});

describe("buildEpisodeTiming", () => {
  it("uses the real audio duration plus tail for total length", () => {
    const a = fakeAlignment(text);
    const timing = buildEpisodeTiming({ scenes, alignment: a, audioDurationMs: 12_345, tailMs: 900 });
    expect(timing.totalDurationMs).toBe(12_345 + 900);
    expect(timing.scenes).toHaveLength(3);
    expect(timing.speechEndMs).toBeLessThan(timing.totalDurationMs);
  });

  it("never ends before speech when the reported duration is short", () => {
    const a = fakeAlignment(text);
    const timing = buildEpisodeTiming({ scenes, alignment: a, audioDurationMs: 10, tailMs: 500 });
    expect(timing.totalDurationMs).toBe(timing.speechEndMs + 500);
  });
});

describe("measuredWordsPerSecond", () => {
  it("needs enough words to be meaningful", () => {
    expect(measuredWordsPerSecond(alignmentToWords(fakeAlignment(text)))).toBeNull();
  });
});
