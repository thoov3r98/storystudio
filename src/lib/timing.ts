/*
 * Converts ElevenLabs character-level alignment into word timings, scene
 * boundaries and caption phrases. All timing comes from the generated audio;
 * nothing here divides total duration evenly across words.
 */

export type CharAlignment = {
  characters: string[];
  characterStartTimesSeconds: number[];
  characterEndTimesSeconds: number[];
};

export type WordTiming = { text: string; startMs: number; endMs: number; charStart: number; charEnd: number };

export type SceneTiming = { sceneNumber: number; startMs: number; endMs: number };

export type CaptionPhrase = { text: string; startMs: number; endMs: number; words: { text: string; startMs: number; endMs: number }[] };

export type EpisodeTiming = {
  audioDurationMs: number;
  speechEndMs: number;
  totalDurationMs: number;
  scenes: SceneTiming[];
  words: WordTiming[];
  captions: CaptionPhrase[];
};

export function validateAlignment(a: CharAlignment): void {
  const n = a.characters.length;
  if (n === 0) throw new Error("Alignment is empty.");
  if (a.characterStartTimesSeconds.length !== n || a.characterEndTimesSeconds.length !== n) {
    throw new Error("Alignment arrays have mismatched lengths.");
  }
}

/** Groups non-whitespace character runs into words using their real start/end times. */
export function alignmentToWords(a: CharAlignment): WordTiming[] {
  validateAlignment(a);
  const words: WordTiming[] = [];
  let current: { chars: string[]; start: number; end: number; charStart: number } | null = null;
  for (let i = 0; i < a.characters.length; i++) {
    const ch = a.characters[i];
    if (/\s/.test(ch)) {
      if (current) {
        words.push(finishWord(current, i));
        current = null;
      }
      continue;
    }
    const start = a.characterStartTimesSeconds[i] * 1000;
    const end = a.characterEndTimesSeconds[i] * 1000;
    if (!current) current = { chars: [ch], start, end, charStart: i };
    else {
      current.chars.push(ch);
      current.end = Math.max(current.end, end);
    }
  }
  if (current) words.push(finishWord(current, a.characters.length));
  return words;
}

function finishWord(w: { chars: string[]; start: number; end: number; charStart: number }, charEnd: number): WordTiming {
  return { text: w.chars.join(""), startMs: Math.round(w.start), endMs: Math.round(w.end), charStart: w.charStart, charEnd };
}

/**
 * Scenes are spoken back-to-back as `scenes.join(" ")`, so each scene owns a
 * known character range of the alignment. A scene starts when its first
 * character is spoken and lasts until the next scene starts; the first scene
 * starts at 0 and the last runs to the end of the video.
 */
export function sceneTimingsFromAlignment(
  sceneNarrations: { sceneNumber: number; narration: string }[],
  alignment: CharAlignment,
  totalDurationMs: number,
): SceneTiming[] {
  validateAlignment(alignment);
  const fullText = alignment.characters.join("");
  const starts: number[] = [];
  let cursor = 0;
  for (const scene of sceneNarrations) {
    const text = scene.narration.trim();
    let idx = fullText.indexOf(text, cursor);
    if (idx === -1) {
      // The provider may normalise whitespace/quotes; fall back to the first word.
      const firstWord = text.split(/\s+/)[0] ?? "";
      idx = firstWord ? fullText.indexOf(firstWord, cursor) : -1;
      if (idx === -1) throw new Error(`Could not locate scene ${scene.sceneNumber} narration in the voiceover alignment.`);
    }
    starts.push(Math.round(alignment.characterStartTimesSeconds[idx] * 1000));
    cursor = idx + Math.max(1, text.length);
  }
  return sceneNarrations.map((scene, i) => ({
    sceneNumber: scene.sceneNumber,
    startMs: i === 0 ? 0 : starts[i],
    endMs: i === sceneNarrations.length - 1 ? totalDurationMs : starts[i + 1],
  }));
}

/**
 * Groups words into short caption phrases (≤ maxWords, ≤ maxChars), breaking
 * after sentence/clause punctuation and on audible pauses.
 */
export function wordsToCaptions(words: WordTiming[], opts: { maxWords?: number; maxChars?: number; pauseMs?: number } = {}): CaptionPhrase[] {
  const maxWords = opts.maxWords ?? 4;
  const maxChars = opts.maxChars ?? 22;
  const pauseMs = opts.pauseMs ?? 350;
  const phrases: CaptionPhrase[] = [];
  let current: WordTiming[] = [];

  const flush = () => {
    if (current.length === 0) return;
    phrases.push({
      text: current.map((w) => w.text).join(" "),
      startMs: current[0].startMs,
      endMs: current[current.length - 1].endMs,
      words: current.map(({ text, startMs, endMs }) => ({ text, startMs, endMs })),
    });
    current = [];
  };

  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const prev = current[current.length - 1];
    const projectedChars = current.reduce((n, x) => n + x.text.length + 1, 0) + w.text.length;
    if (current.length > 0 && (current.length >= maxWords || projectedChars > maxChars || (prev && w.startMs - prev.endMs > pauseMs))) {
      flush();
    }
    current.push(w);
    if (/[.!?;:,—]$/.test(w.text)) flush();
  }
  flush();
  return phrases;
}

export function buildEpisodeTiming(input: {
  scenes: { sceneNumber: number; narration: string }[];
  alignment: CharAlignment;
  audioDurationMs: number;
  tailMs: number;
}): EpisodeTiming {
  const words = alignmentToWords(input.alignment);
  const speechEndMs = words.length ? words[words.length - 1].endMs : 0;
  const totalDurationMs = Math.max(input.audioDurationMs, speechEndMs) + input.tailMs;
  return {
    audioDurationMs: input.audioDurationMs,
    speechEndMs,
    totalDurationMs,
    scenes: sceneTimingsFromAlignment(input.scenes, input.alignment, totalDurationMs),
    words,
    captions: wordsToCaptions(words),
  };
}

export function msToFrames(ms: number, fps: number): number {
  return Math.round((ms / 1000) * fps);
}

/** Measured words-per-second for calibrating script length to a voice. */
export function measuredWordsPerSecond(words: WordTiming[]): number | null {
  if (words.length < 20) return null;
  const spokenMs = words[words.length - 1].endMs - words[0].startMs;
  return spokenMs > 0 ? words.length / (spokenMs / 1000) : null;
}
