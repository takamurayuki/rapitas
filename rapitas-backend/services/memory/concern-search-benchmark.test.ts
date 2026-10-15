/**
 * concern-search-benchmark.test.ts
 *
 * Acceptance benchmark: intent-extraction accuracy of the voice-query parser over
 * a labelled corpus (>= 90%) plus a known-answer check of the WER calculator.
 * Real-microphone WER is out of scope (environment dependent, not automatable).
 */
import { describe, it, expect } from 'bun:test';
import { parseConcernQuery } from './concern-search-parser';
import {
  ENGLISH_CORPUS,
  JAPANESE_CORPUS,
  wordErrorRate,
  type CorpusCase,
} from './concern-search-benchmark-corpus';

const ACCURACY_THRESHOLD = 0.9;

function accuracy(cases: CorpusCase[]): { rate: number; failures: string[] } {
  const failures: string[] = [];
  for (const c of cases) {
    const p = parseConcernQuery(c.text);
    const ok = p.type === c.type && JSON.stringify(p.severities) === JSON.stringify(c.severities);
    if (!ok) failures.push(c.text);
  }
  return { rate: (cases.length - failures.length) / cases.length, failures };
}

describe('concern search intent benchmark', () => {
  it('has 50 labelled cases', () => {
    expect(ENGLISH_CORPUS).toHaveLength(30);
    expect(JAPANESE_CORPUS).toHaveLength(20);
  });

  it('meets the >= 90% intent-extraction accuracy over the whole corpus', () => {
    const all = accuracy([...ENGLISH_CORPUS, ...JAPANESE_CORPUS]);
    expect(all.failures).toEqual([]);
    expect(all.rate).toBeGreaterThanOrEqual(ACCURACY_THRESHOLD);
  });

  it('meets the threshold per language', () => {
    expect(accuracy(ENGLISH_CORPUS).rate).toBeGreaterThanOrEqual(ACCURACY_THRESHOLD);
    expect(accuracy(JAPANESE_CORPUS).rate).toBeGreaterThanOrEqual(ACCURACY_THRESHOLD);
  });
});

describe('wordErrorRate', () => {
  it('matches known pairs exactly', () => {
    expect(wordErrorRate('a b c d', 'a b c d')).toBe(0);
    expect(wordErrorRate('a b c d', 'a x c d')).toBe(0.25);
    expect(wordErrorRate('a b c d', 'a b c')).toBe(0.25);
    expect(wordErrorRate('a b', 'a b c d')).toBe(1);
    expect(wordErrorRate('', '')).toBe(0);
  });
});
