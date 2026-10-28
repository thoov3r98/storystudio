import { normalizeTitle, tokenize } from "./text";

/*
 * Lightweight duplicate detection, no vector infrastructure:
 *  - normalized title equality
 *  - character-trigram similarity of titles
 *  - keyword/content-word Jaccard similarity of title + premise + keywords
 */

const CONTENT_STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "with", "your", "you", "is", "are", "was", "it", "its", "that",
  "this", "what", "when", "where", "why", "how", "who", "if", "then", "but", "be", "can", "will", "from", "at", "by", "as",
  "into", "about", "after", "before", "than", "they", "their", "them", "there", "happens", "really", "actually", "every",
]);

export function contentTerms(text: string): Set<string> {
  return new Set(
    tokenize(text)
      .filter((t) => t.length > 2 && !CONTENT_STOPWORDS.has(t))
      .map(stem),
  );
}

/** Very small suffix stripper so "suitcases"/"suitcase" and "checked"/"check" match. */
export function stem(word: string): string {
  return word.replace(/(ies)$/, "y").replace(/(ing|ed|es|s)$/, "") || word;
}

export function trigrams(text: string): Set<string> {
  const s = `  ${text.toLowerCase().replace(/[^a-z0-9 ]+/g, "").replace(/\s+/g, " ").trim()} `;
  const out = new Set<string>();
  for (let i = 0; i < s.length - 2; i++) out.add(s.slice(i, i + 3));
  return out;
}

export function jaccard<T>(a: Set<T>, b: Set<T>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

export type Comparable = { title: string; premise: string; keywords: string[] };

export type SimilarityResult = {
  score: number;
  titleExact: boolean;
  titleSimilarity: number;
  contentSimilarity: number;
};

export function similarity(a: Comparable, b: Comparable): SimilarityResult {
  const na = normalizeTitle(a.title);
  const nb = normalizeTitle(b.title);
  const titleExact = na.length > 0 && na === nb;
  const titleSimilarity = jaccard(trigrams(na), trigrams(nb));
  const contentSimilarity = jaccard(
    contentTerms(`${a.title} ${a.premise} ${a.keywords.join(" ")}`),
    contentTerms(`${b.title} ${b.premise} ${b.keywords.join(" ")}`),
  );
  const score = titleExact ? 1 : Math.max(titleSimilarity * 0.9, contentSimilarity * 1.15, titleSimilarity * 0.5 + contentSimilarity * 0.6);
  return { score: Math.min(1, Math.round(score * 1000) / 1000), titleExact, titleSimilarity, contentSimilarity };
}

export const DUPLICATE_THRESHOLD = 0.55;

export function findClosest<T extends Comparable>(candidate: Comparable, pool: T[]): { match: T; result: SimilarityResult } | null {
  let best: { match: T; result: SimilarityResult } | null = null;
  for (const item of pool) {
    const result = similarity(candidate, item);
    if (!best || result.score > best.result.score) best = { match: item, result };
  }
  return best;
}

/**
 * Splits candidates into unique and duplicate sets, comparing each against the
 * existing library and against earlier candidates in the same batch.
 */
export function dedupeCandidates<T extends Comparable>(
  candidates: T[],
  existing: Comparable[],
  threshold = DUPLICATE_THRESHOLD,
): { unique: T[]; duplicates: { candidate: T; duplicateOf: Comparable; score: number }[] } {
  const unique: T[] = [];
  const duplicates: { candidate: T; duplicateOf: Comparable; score: number }[] = [];
  for (const c of candidates) {
    const closest = findClosest(c, [...existing, ...unique]);
    if (closest && (closest.result.titleExact || closest.result.score >= threshold)) {
      duplicates.push({ candidate: c, duplicateOf: closest.match, score: closest.result.score });
    } else {
      unique.push(c);
    }
  }
  return { unique, duplicates };
}
