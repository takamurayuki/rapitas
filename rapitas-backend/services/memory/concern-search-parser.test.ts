/**
 * concern-search-parser.test.ts
 *
 * Golden tests for the deterministic voice/text query parser. The same cases
 * are mirrored in the frontend concern-search-utils.test.ts to detect drift.
 */
import { describe, it, expect } from 'bun:test';
import { parseConcernQuery } from './concern-search-parser';

describe('parseConcernQuery', () => {
  it('parses the canonical voice query', () => {
    expect(parseConcernQuery('Show me PERF-related blocking concerns')).toEqual({
      type: 'perf',
      severities: ['urgent', 'high'],
      keywords: [],
    });
  });

  it('is case-insensitive and keeps free keywords', () => {
    expect(parseConcernQuery('show me performance concerns about database')).toEqual({
      type: 'perf',
      severities: [],
      keywords: ['database'],
    });
  });

  it('parses Japanese queries', () => {
    expect(parseConcernQuery('パフォーマンス関連の緊急な懸念を表示')).toEqual({
      type: 'perf',
      severities: ['urgent', 'high'],
      keywords: [],
    });
  });

  it('returns an empty parse for empty or unknown input without throwing', () => {
    expect(parseConcernQuery('')).toEqual({ type: undefined, severities: [], keywords: [] });
    expect(parseConcernQuery('   ')).toEqual({ type: undefined, severities: [], keywords: [] });
    expect(parseConcernQuery('zzqx')).toEqual({
      type: undefined,
      severities: [],
      keywords: ['zzqx'],
    });
  });
});
