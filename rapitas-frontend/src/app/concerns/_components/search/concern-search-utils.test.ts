/**
 * concern-search-utils.test.ts
 *
 * Mirrors the backend golden parser cases (drift detection) and covers the local
 * offline search plus the screen-reader phrase.
 */
import { describe, it, expect } from 'vitest';
import jaMessages from '../../../../../messages/ja.json';
import { parseConcernQuery, searchLocal, formatSpoken } from './concern-search-utils';
import type { ConcernSearchItem } from './concern-search.types';

describe('parseConcernQuery (mirror of backend golden cases)', () => {
  it('parses the canonical voice query', () => {
    expect(parseConcernQuery('Show me PERF-related blocking concerns')).toEqual({
      type: 'perf',
      severities: ['urgent', 'high'],
      keywords: [],
    });
  });
  it('keeps free keywords', () => {
    expect(parseConcernQuery('show me performance concerns about database')).toEqual({
      type: 'perf',
      severities: [],
      keywords: ['database'],
    });
  });
  it('parses Japanese', () => {
    expect(parseConcernQuery('パフォーマンス関連の緊急な懸念を表示')).toEqual({
      type: 'perf',
      severities: ['urgent', 'high'],
      keywords: [],
    });
  });
  it('never throws on empty input', () => {
    expect(parseConcernQuery('')).toEqual({ type: undefined, severities: [], keywords: [] });
    expect(parseConcernQuery('zzqx').keywords).toEqual(['zzqx']);
  });
});

const items: ConcernSearchItem[] = [
  {
    id: 1,
    title: 'Slow DB query',
    impactScore: 9.1,
    relatedTasks: 2,
    priority: 'Critical',
    pattern: '⬛⬛⬛',
  },
  {
    id: 2,
    title: 'Large bundle',
    impactScore: 6.5,
    relatedTasks: 0,
    priority: 'High',
    pattern: '⬛⬛⬜',
  },
  {
    id: 3,
    title: 'Slow render',
    impactScore: 2.0,
    relatedTasks: 0,
    priority: 'Low',
    pattern: '⬜⬜⬜',
  },
];

describe('searchLocal', () => {
  it('returns everything for an empty query', () => {
    expect(searchLocal(items, '')).toHaveLength(3);
  });
  it('filters by keyword in the title, case-insensitively', () => {
    expect(searchLocal(items, 'SLOW').map((i) => i.id)).toEqual([1, 3]);
  });
  it('applies blocking severity to Critical/High', () => {
    expect(searchLocal(items, 'Show me PERF-related blocking concerns').map((i) => i.id)).toEqual([
      1, 2,
    ]);
  });
});

describe('formatSpoken', () => {
  it('renders the exact Japanese screen-reader phrase', () => {
    const t = (key: string, values: Record<string, string | number>) => {
      const tpl = (jaMessages as { concerns: { search: Record<string, string> } }).concerns.search[
        key.replace('search.', '')
      ];
      return tpl.replace(/\{(\w+)\}/g, (_, k) => String(values[k]));
    };
    expect(formatSpoken(t, { ...items[0], impactScore: 8.5, relatedTasks: 3 })).toBe(
      '影響度 8.5、関連タスク 3件、優先度 Critical',
    );
  });
  it('keeps one decimal for whole scores and zero related tasks', () => {
    const t = (_k: string, v: Record<string, string | number>) =>
      `${v.score}/${v.count}/${v.priority}`;
    expect(formatSpoken(t, { ...items[1], impactScore: 6, relatedTasks: 0 })).toBe('6.0/0/High');
  });
});
