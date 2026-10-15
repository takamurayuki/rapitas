/**
 * icon-search
 *
 * Provides `searchIcons()` for full Japanese/English icon lookup with relevance
 * ranking. Also exports `ICON_NAMES` and `getIconComponent` for convenience.
 */
import type { LucideIcon } from 'lucide-react';
import { ICON_DATA } from './icon-registry';

/** Array of all registered icon names. */
export const ICON_NAMES = Object.keys(ICON_DATA);

/** Look up a Lucide component by its registry name. */
export const getIconComponent = (name: string): LucideIcon | undefined => {
  return ICON_DATA[name]?.component;
};

// ── Search index ──────────────────────────────────────────────────────────────

/**
 * Build a substring index over English icon names (2-3-gram) and all
 * substrings of every Japanese keyword. Constructed once on first use.
 */
const createSearchIndex = (): Map<string, Set<string>> => {
  const index = new Map<string, Set<string>>();
  const add = (key: string, name: string) => {
    if (!index.has(key)) index.set(key, new Set());
    index.get(key)!.add(name);
  };

  for (const name of ICON_NAMES) {
    const info = ICON_DATA[name];
    const lowerName = name.toLowerCase();

    // English name n-grams (2–3 chars) for prefix-style lookup
    for (let i = 0; i < lowerName.length - 1; i++) {
      add(lowerName.slice(i, i + 2), name);
      if (i < lowerName.length - 2) add(lowerName.slice(i, i + 3), name);
    }

    // All substrings of every keyword (handles Japanese exactly)
    for (const kw of info.keywords) {
      for (let i = 0; i < kw.length; i++) {
        for (let j = i + 1; j <= kw.length; j++) {
          add(kw.slice(i, j), name);
        }
      }
    }
  }

  return index;
};

let searchIndex: Map<string, Set<string>> | null = null;

// ── Scoring constants ─────────────────────────────────────────────────────────

const S_NAME_EXACT = 10;
const S_NAME_STARTS = 7;
const S_KW_EXACT = 8;
const S_KW_STARTS = 6;
const S_NAME_INCLUDES = 4;
const S_KW_INCLUDES = 3;
const S_KW_LOWER = 2;
const S_INDEX_HIT = 3;

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Search icons by name or keyword, returning results sorted by relevance.
 *
 * Handles both Japanese and English queries. The algorithm runs a linear
 * keyword scan on every query (guaranteeing coverage) and supplements with
 * the pre-built n-gram / substring index for speed on longer queries.
 *
 * @param query - Free-text search query / 検索クエリ（日本語・英語どちらも可）
 * @returns Matching icon names ordered from most to least relevant.
 */
export const searchIcons = (query: string): string[] => {
  if (!query.trim()) return ICON_NAMES;

  const q = query.trim();
  const qLower = q.toLowerCase();

  // Lazy-init index
  if (!searchIndex) searchIndex = createSearchIndex();

  const scores = new Map<string, number>();
  const bump = (name: string, s: number) => {
    if (s > (scores.get(name) ?? 0)) scores.set(name, s);
  };

  // ① Full linear scan — covers every icon regardless of index state.
  //   This is the correctness guarantee: no match is ever silently dropped
  //   because the index was built without a particular keyword.
  for (const name of ICON_NAMES) {
    const lower = name.toLowerCase();

    // English name scoring
    if (lower === qLower) {
      bump(name, S_NAME_EXACT);
      continue;
    }
    if (lower.startsWith(qLower)) bump(name, S_NAME_STARTS);
    else if (lower.includes(qLower)) bump(name, S_NAME_INCLUDES);

    // Keyword scoring
    const kws = ICON_DATA[name]?.keywords ?? [];
    let kwScore = 0;
    for (const kw of kws) {
      if (kw === q) {
        kwScore = S_KW_EXACT;
        break;
      }
      if (kw.startsWith(q)) {
        kwScore = Math.max(kwScore, S_KW_STARTS);
      } else if (kw.includes(q)) {
        kwScore = Math.max(kwScore, S_KW_INCLUDES);
      } else if (kw.toLowerCase().includes(qLower)) {
        kwScore = Math.max(kwScore, S_KW_LOWER);
      }
    }
    if (kwScore > 0) bump(name, kwScore);
  }

  // ② Index supplement (adds a small bonus for hits already scored above, or
  //   catches anything the linear scan missed due to the index covering n-grams).
  searchIndex.get(q)?.forEach((name) => bump(name, S_INDEX_HIT));
  searchIndex.get(qLower)?.forEach((name) => bump(name, S_INDEX_HIT));

  return Array.from(scores.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name);
};
