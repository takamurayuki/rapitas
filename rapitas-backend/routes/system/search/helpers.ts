/**
 * Search Helpers
 *
 * Pure utility functions for text excerpt generation, match context detection,
 * and relevance scoring. No database or HTTP dependencies.
 */

/** Shape of a single cross-entity search result. */
export type SearchResultItem = {
  id: number;
  type: 'task' | 'comment' | 'note' | 'resource';
  title: string;
  excerpt: string;
  relevance: number;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt?: Date;
};

/**
 * Generate an excerpt by extracting text around the first match location.
 *
 * @param text - Source text to excerpt / 抜粋元テキスト
 * @param query - Search query used to locate the excerpt position / 検索クエリ
 * @param maxLength - Maximum excerpt length when no match is found / マッチなし時の最大文字数
 * @returns Excerpt string with ellipsis prefix/suffix when truncated / 切り詰め時に省略記号付きの抜粋
 */
export function createExcerpt(text: string, query: string, maxLength = 200): string {
  if (!text) return '';
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const index = lowerText.indexOf(lowerQuery);

  if (index === -1) {
    return text.length > maxLength ? text.slice(0, maxLength) + '...' : text;
  }

  const start = Math.max(0, index - 50);
  const end = Math.min(text.length, index + query.length + 150);
  let excerpt = text.slice(start, end);

  if (start > 0) excerpt = '...' + excerpt;
  if (end < text.length) excerpt = excerpt + '...';

  return excerpt;
}

/**
 * Identify where in the record the search query matched (title or description).
 *
 * @param text - Primary field text (usually title) / 主フィールドテキスト（通常タイトル）
 * @param description - Optional secondary field / サブフィールド（説明文）
 * @param query - Search query / 検索クエリ
 * @returns 'title' or 'description' / 'title'または'description'
 */
export function getMatchContext(text: string, description: string | null, query: string): string {
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();

  if (lowerText.includes(lowerQuery)) return 'title';

  if (description && description.toLowerCase().includes(lowerQuery)) return 'description';

  const words = lowerQuery.split(/\s+/).filter((w) => w.length > 0);
  for (const word of words) {
    if (lowerText.includes(word)) return 'title';
    if (description && description.toLowerCase().includes(word)) return 'description';
  }

  return 'title'; // fallback
}

/**
 * Calculate a relevance score (0–100) for a search result based on match quality and recency.
 *
 * @param text - Primary field text / 主フィールドテキスト
 * @param description - Optional secondary field / サブフィールド
 * @param query - Search query / 検索クエリ
 * @param options - Scoring context flags / スコアリングコンテキスト
 * @returns Relevance score clamped to [0, 100] / 0〜100のスコア
 */
export function calculateRelevance(
  text: string,
  description: string | null,
  query: string,
  options: {
    isTitle?: boolean;
    isDescription?: boolean;
    updatedAt?: Date;
    status?: string;
  } = {},
): number {
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const words = lowerQuery.split(/\s+/).filter((w) => w.length > 0);

  let score = 0;

  if (lowerText === lowerQuery) {
    score = options.isTitle ? 100 : 20;
  } else if (lowerText.startsWith(lowerQuery)) {
    score = options.isTitle ? 50 : 15;
  } else if (lowerText.includes(lowerQuery)) {
    score = options.isTitle ? 30 : 10;
  } else {
    let wordMatches = 0;
    for (const word of words) {
      if (word && lowerText.includes(word)) wordMatches++;
    }
    if (wordMatches > 0) {
      score = options.isTitle
        ? (wordMatches / words.length) * 25
        : (wordMatches / words.length) * 8;
    }
  }

  // Additional score for description (when not title)
  if (!options.isTitle && description) {
    const lowerDesc = description.toLowerCase();
    if (lowerDesc.includes(lowerQuery)) {
      score += 20;
    } else {
      let descWordMatches = 0;
      for (const word of words) {
        if (word && lowerDesc.includes(word)) descWordMatches++;
      }
      score += (descWordMatches / words.length) * 5;
    }
  }

  // Recent update bonus (within 7 days)
  if (options.updatedAt) {
    const daysDiff = (Date.now() - options.updatedAt.getTime()) / (1000 * 60 * 60 * 24);
    if (daysDiff <= 7) score += 5;
  }

  // Active status bonus
  if (options.status && (options.status === 'todo' || options.status === 'in_progress')) {
    score += 3;
  }

  return Math.min(score, 100);
}
