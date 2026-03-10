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
