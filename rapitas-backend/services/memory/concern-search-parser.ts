/**
 * concern-search-parser
 *
 * Deterministic rule-based parser turning a voice/text query (English or
 * Japanese) into a concern filter. NOT an LLM: it must stay offline-capable and
 * benchmarkable. The frontend keeps an identical copy (concern-search-utils.ts);
 * both are pinned by the same golden tests.
 */

export type ParsedConcernType = 'bug' | 'refactor' | 'security' | 'perf' | 'other';
export type ParsedConcernSeverity = 'urgent' | 'high' | 'medium' | 'low';

export interface ParsedConcernQuery {
  type: ParsedConcernType | undefined;
  severities: ParsedConcernSeverity[];
  keywords: string[];
}

const TYPE_WORDS: Record<string, ParsedConcernType> = {
  perf: 'perf',
  performance: 'perf',
  パフォーマンス: 'perf',
  性能: 'perf',
  bug: 'bug',
  バグ: 'bug',
  security: 'security',
  セキュリティ: 'security',
  refactor: 'refactor',
  リファクタ: 'refactor',
};

const BLOCKING: ParsedConcernSeverity[] = ['urgent', 'high'];
const SEVERITY_WORDS: Record<string, ParsedConcernSeverity[]> = {
  blocking: BLOCKING,
  blocker: BLOCKING,
  critical: BLOCKING,
  urgent: BLOCKING,
  致命: BLOCKING,
  緊急: BLOCKING,
  ブロック: BLOCKING,
  high: ['high'],
  medium: ['medium'],
  low: ['low'],
  minor: ['low'],
  軽微: ['low'],
};

const STOP_WORDS = new Set([
  'show', 'me', 'list', 'find', 'search', 'all', 'the', 'a', 'an', 'of', 'related',
  'concern', 'concerns', 'issue', 'issues', 'with', 'for', 'please', 'give', 'get',
  'only', 'and', 'about',
]); // prettier-ignore

// Japanese has no word boundaries, so these are stripped as substrings.
const JP_STOP_SUBSTRINGS = [
  '懸念', '表示', '検索', '関連', '一覧', '見せて', '教えて', 'ください', 'して', 'な', 'の', 'を', 'は', 'が',
]; // prettier-ignore

/**
 * Parses a free-text/voice query into type, severities and residual keywords.
 *
 * @param text - Raw query text / 生のクエリ文字列
 * @returns Parsed filter; never throws / 解析結果（例外は投げない）
 */
export function parseConcernQuery(text: string): ParsedConcernQuery {
  let rest = (text ?? '').toLowerCase();
  let type: ParsedConcernType | undefined;
  const severities: ParsedConcernSeverity[] = [];

  // Longest words first so 'performance' is consumed before 'perf'.
  const jpAndEn = [...Object.keys(TYPE_WORDS), ...Object.keys(SEVERITY_WORDS)].sort(
    (a, b) => b.length - a.length,
  );
  const isAscii = (w: string) => /^[a-z]+$/.test(w);
  for (const word of jpAndEn) {
    const re = isAscii(word)
      ? new RegExp(`(?<![a-z])${word}(?![a-z])`, 'g')
      : new RegExp(word, 'g');
    if (!re.test(rest)) continue;
    if (word in TYPE_WORDS && !type) type = TYPE_WORDS[word];
    if (word in SEVERITY_WORDS) {
      for (const s of SEVERITY_WORDS[word]) if (!severities.includes(s)) severities.push(s);
    }
    rest = rest.replace(re, ' ');
  }
  for (const sub of JP_STOP_SUBSTRINGS) rest = rest.split(sub).join(' ');

  const keywords = (rest.match(/[\p{L}\p{N}_]+/gu) ?? []).filter((k) => !STOP_WORDS.has(k));
  return { type, severities, keywords };
}
