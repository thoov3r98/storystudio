/** Lowercase, strip punctuation and filler words so near-identical titles compare equal. */
const TITLE_STOPWORDS = new Set([
  "a", "an", "the", "what", "where", "when", "why", "how", "who", "does", "do", "is", "are", "your", "you", "if", "really",
  "actually", "happens", "happen", "to", "of", "on", "in", "and", "or", "it", "its", "after", "suddenly", "every", "goes", "go",
]);

export function normalizeTitle(title: string): string {
  return tokenize(title)
    .filter((t) => !TITLE_STOPWORDS.has(t))
    .join(" ");
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['’]/g, "")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

export const DEFAULT_WORDS_PER_SECOND = 2.5;

/**
 * Estimated spoken duration. Word count alone under-predicts runtime, so
 * sentence and clause boundaries add the pauses a narrator naturally takes.
 * `wordsPerSecond` should come from the selected voice's measured rate when known.
 */
export function estimateSpokenDuration(text: string, wordsPerSecond = DEFAULT_WORDS_PER_SECOND): number {
  const words = countWords(text);
  const sentenceBreaks = (text.match(/[.!?]+(\s|$)/g) ?? []).length;
  const clauseBreaks = (text.match(/[,;:—–]/g) ?? []).length;
  const seconds = words / wordsPerSecond + sentenceBreaks * 0.22 + clauseBreaks * 0.08;
  return Math.round(seconds * 10) / 10;
}

export function joinNarration(scenes: { narration: string }[]): string {
  return scenes
    .map((s) => s.narration.trim())
    .filter(Boolean)
    .join(" ");
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}
