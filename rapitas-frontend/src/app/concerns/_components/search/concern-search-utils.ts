/**
 * concern-search-utils
 *
 * Client-side copy of the backend query parser plus the offline local search and
 * the screen-reader phrase builder. The parser MUST stay behaviourally identical to
 * rapitas-backend/services/memory/concern-search-parser.ts (no shared package
 * exists in this monorepo); both are pinned by the same golden test cases.
 */
import type {
  ConcernPriority,
  ConcernSearchItem,
  ParsedConcernQuery,
} from './concern-search.types';

type ParsedType = NonNullable<ParsedConcernQuery['type']>;
type ParsedSeverity = ParsedConcernQuery['severities'][number];

const TYPE_WORDS: Record<string, ParsedType> = {
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

const BLOCKING: ParsedSeverity[] = ['urgent', 'high'];
const SEVERITY_WORDS: Record<string, ParsedSeverity[]> = {
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

const SEVERITY_TO_PRIORITY: Record<ParsedSeverity, ConcernPriority> = {
  urgent: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

/**
 * Parses a free-text/voice query into type, severities and residual keywords.
 *
 * @param text - Raw query text / 生のクエリ文字列
 * @returns Parsed filter; never throws / 解析結果（例外は投げない）
 */
export function parseConcernQuery(text: string): ParsedConcernQuery {
  let rest = (text ?? '').toLowerCase();
  let type: ParsedType | undefined;
  const severities: ParsedSeverity[] = [];

  // Longest words first so 'performance' is consumed before 'perf'.
  const words = [...Object.keys(TYPE_WORDS), ...Object.keys(SEVERITY_WORDS)].sort(
    (a, b) => b.length - a.length,
  );
  for (const word of words) {
    const re = /^[a-z]+$/.test(word)
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

/**
 * Filters cached search items locally (offline fallback).
 *
 * @param items - Cached PERF items / キャッシュ済みアイテム
 * @param query - Raw query text / クエリ文字列
 * @returns Items matching severity and title keywords / 条件に合うアイテム
 */
export function searchLocal(items: ConcernSearchItem[], query: string): ConcernSearchItem[] {
  const parsed = parseConcernQuery(query);
  const priorities = new Set(parsed.severities.map((s) => SEVERITY_TO_PRIORITY[s]));
  return items.filter((item) => {
    if (priorities.size > 0 && !priorities.has(item.priority)) return false;
    const title = item.title.toLowerCase();
    return parsed.keywords.every((k) => title.includes(k));
  });
}

type Translate = (key: string, values: Record<string, string | number>) => string;

/**
 * Builds the screen-reader phrase for a hit (score always one decimal).
 *
 * @param t - Translator scoped to the `concerns` namespace / 翻訳関数
 * @param item - Search hit / 検索結果
 * @returns e.g. 影響度 8.5、関連タスク 3件、優先度 Critical
 */
export function formatSpoken(t: Translate, item: ConcernSearchItem): string {
  return t('search.spoken', {
    score: item.impactScore.toFixed(1),
    count: item.relatedTasks,
    priority: item.priority,
  });
}
