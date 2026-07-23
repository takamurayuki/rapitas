/**
 * text-similarity
 *
 * Character-bigram Jaccard similarity for Japanese/English mixed short texts.
 * Embedding cosine is unreliable for Japanese near-duplicate detection (two
 * paraphrases of the same lesson often score below any usable threshold), so
 * lexical bigram overlap is the proven dedup signal here — the same technique
 * already gates ideas and concerns. Extracted from hypothesis-from-verify.ts.
 */

/** Normalize for fuzzy matching: drop markdown/backticks/whitespace, lowercase. */
export function normalizeForMatch(s: string): string {
  return s
    .toLowerCase()
    .replace(/[`*_#>~\s、。,.:：()「」『』【】\[\]]/g, '')
    .trim();
}

/** Character-bigram set of a normalized string. */
function bigrams(s: string): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < s.length - 1; i++) out.add(s.slice(i, i + 2));
  return out;
}

/**
 * Bigram-Jaccard similarity between two strings (0..1). Robust to paraphrasing
 * (reordering, dropped backticks, inserted particles) which defeats both
 * longest-common-substring matching and, for Japanese, embedding cosine.
 *
 * @param a - First string. / 比較文字列A
 * @param b - Second string. / 比較文字列B
 * @returns Jaccard similarity of character bigrams (0..1). / 類似度
 */
export function bigramSimilarity(a: string, b: string): number {
  const A = bigrams(normalizeForMatch(a));
  const B = bigrams(normalizeForMatch(b));
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const g of A) if (B.has(g)) inter += 1;
  return inter / (A.size + B.size - inter);
}

/**
 * Directional bigram coverage: the fraction of the QUERY's bigrams found in
 * the target (0..1). Unlike Jaccard, the denominator excludes the target's
 * own bigrams, so a short query fully contained in a long knowledge entry
 * still scores near 1 (Jaccard collapses to ~0.03 there) — this is the
 * "how much of what the user typed appears in this entry" signal used for
 * related-knowledge relevance.
 *
 * @param query - User-typed search text. / 検索クエリ
 * @param target - Knowledge entry text to match against. / 照合対象テキスト
 * @returns Fraction of query bigrams present in target (0..1). / 被覆率
 */
export function bigramCoverage(query: string, target: string): number {
  const Q = bigrams(normalizeForMatch(query));
  if (Q.size === 0) return 0;
  const T = bigrams(normalizeForMatch(target));
  let inter = 0;
  for (const g of Q) if (T.has(g)) inter += 1;
  return inter / Q.size;
}

/**
 * Minimum bigramCoverage for a knowledge entry to count as "related" to a
 * draft task. Deliberately far below NEARDUP_TITLE_SIM (0.6): this gates
 * relatedness, not sameness — a short Japanese title (~9 bigrams) passes
 * when its subject words appear in the entry but not on 2-3 accidental
 * bigram hits.
 */
export const RELATED_KNOWLEDGE_MIN_COVERAGE = 0.25;

/**
 * Bigram-Jaccard thresholds above which a knowledge-entry PAIR is a
 * near-duplicate (same lesson, different wording) — dedup territory, never a
 * contradiction. Without this gate, N paraphrases of one lesson produced
 * O(N²) LLM-judged "contradiction" pairs (observed: 8,883 open rows dominated
 * by identically titled merge-conflict lessons).
 */
export const NEARDUP_TITLE_SIM = 0.6;
export const NEARDUP_CONTENT_SIM = 0.7;

/** Minimal entry fields the near-duplicate pair check needs. */
export interface NearDupEntry {
  title: string;
  content: string;
}

/**
 * Whether two knowledge entries state the same lesson in different words.
 *
 * @param a - First entry. / エントリA
 * @param b - Second entry. / エントリB
 * @returns True when the pair should be deduped, not contradiction-flagged.
 */
export function isNearDuplicatePair(a: NearDupEntry, b: NearDupEntry): boolean {
  return (
    bigramSimilarity(a.title, b.title) >= NEARDUP_TITLE_SIM ||
    bigramSimilarity(a.content, b.content) >= NEARDUP_CONTENT_SIM
  );
}
