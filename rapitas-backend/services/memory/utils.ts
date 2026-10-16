/**
 * メモリシステム共通ユーティリティ
 */
import { createHash } from 'crypto';

/**
 * コンテンツのハッシュを生成
 */
export function createContentHash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}

/**
 * Parse a `KnowledgeEntry.tags` JSON column into a plain string array.
 *
 * Every producer of this column is expected to write a `string[]`, but the
 * hypothesis ledger overloads the SAME column to store `{evidence:[...]}`
 * instead (a deliberate storage hack — see hypothesis-service.ts's file
 * header). A bare `JSON.parse(tags) as string[]` cast lies to TypeScript in
 * that case and returns the raw object; consumers that then `.map()`/
 * `flatMap()` it either crash (object has no array methods) or, worse,
 * silently splice the raw object into a merged array as a single element
 * (exactly what happened in consolidation.ts, later crashing the frontend
 * with "Objects are not valid as a React child... {evidence}"). Filtering
 * to string elements only makes this defensive regardless of what a future
 * sourceType decides to stash in `tags`.
 *
 * @param raw - The raw `tags` column value. / tagsカラムの生の値
 * @returns Only the string elements, or `[]` on anything else (non-array,
 *   invalid JSON). / 文字列要素のみ（それ以外は空配列）
 */
export function parseTagsAsStrings(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((t): t is string => typeof t === 'string');
  } catch {
    return [];
  }
}

/**
 * コサイン類似度を計算
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;

  return dotProduct / denominator;
}
