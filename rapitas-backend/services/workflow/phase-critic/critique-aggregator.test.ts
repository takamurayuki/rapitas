/**
 * critique-aggregator.test
 *
 * Dedicated unit tests for aggregateCritiques() covering the branches not
 * already exercised by phase-critic.test.ts's shared smoke coverage: the
 * exact-half majority boundary, the MAX_REASONS cap, whitespace/duplicate
 * issue trimming, and severity aggregation across passing verdicts too.
 */
import { describe, it, expect } from 'bun:test';
import { aggregateCritiques, SEVERE_THRESHOLD } from './critique-aggregator';
import type { CriticVerdict } from './phase-critic-types';

const verdict = (over: Partial<CriticVerdict>): CriticVerdict => ({
  lens: 'l',
  pass: true,
  severity: 0,
  issues: [],
  ...over,
});

describe('aggregateCritiques — boundaries', () => {
  it('returns unknown for an empty verdict list (fail-open)', () => {
    expect(aggregateCritiques([])).toEqual({ verdict: 'unknown', severity: 0, reasons: [] });
  });

  it('does not fail on an exact half split (2 of 4) below severe threshold', () => {
    const r = aggregateCritiques([
      verdict({ pass: false, severity: 10, issues: ['a'] }),
      verdict({ pass: false, severity: 10, issues: ['b'] }),
      verdict({ pass: true }),
      verdict({ pass: true }),
    ]);
    expect(r.verdict).toBe('pass');
  });

  it('fails once fails exceed half (3 of 4)', () => {
    const r = aggregateCritiques([
      verdict({ pass: false, severity: 10, issues: ['a'] }),
      verdict({ pass: false, severity: 10, issues: ['b'] }),
      verdict({ pass: false, severity: 10, issues: ['c'] }),
      verdict({ pass: true }),
    ]);
    expect(r.verdict).toBe('fail');
  });

  it('fails on a lone severe verdict at exactly the threshold', () => {
    const r = aggregateCritiques([
      verdict({ pass: false, severity: SEVERE_THRESHOLD, issues: ['x'] }),
      verdict({ pass: true }),
      verdict({ pass: true }),
      verdict({ pass: true }),
    ]);
    expect(r.verdict).toBe('fail');
  });

  it('does not treat one below the severe threshold as severe', () => {
    const r = aggregateCritiques([
      verdict({ pass: false, severity: SEVERE_THRESHOLD - 1, issues: ['x'] }),
      verdict({ pass: true }),
      verdict({ pass: true }),
      verdict({ pass: true }),
    ]);
    expect(r.verdict).toBe('pass');
  });

  it('takes the max severity across ALL verdicts, including passing ones', () => {
    const r = aggregateCritiques([
      verdict({ pass: false, severity: 10, issues: ['a'] }),
      verdict({ pass: true, severity: 65 }),
    ]);
    expect(r.severity).toBe(65);
  });

  it('caps reasons at MAX_REASONS (8) even when more issues exist', () => {
    const many = Array.from({ length: 10 }, (_, i) => `issue-${i}`);
    const r = aggregateCritiques([verdict({ pass: false, severity: 90, issues: many })]);
    expect(r.reasons).toHaveLength(8);
    expect(r.reasons[0]).toBe('[l] issue-0');
    expect(r.reasons[7]).toBe('[l] issue-7');
  });

  it('caps reasons across multiple failing lenses, not per lens', () => {
    const r = aggregateCritiques([
      verdict({ lens: 'a', pass: false, severity: 90, issues: ['1', '2', '3', '4', '5'] }),
      verdict({ lens: 'b', pass: false, severity: 90, issues: ['6', '7', '8', '9'] }),
    ]);
    expect(r.reasons).toHaveLength(8);
    expect(r.reasons[7]).toBe('[b] 8');
  });

  it('trims whitespace and de-dupes issues that only differ by surrounding whitespace', () => {
    const r = aggregateCritiques([
      verdict({ lens: 'a', pass: false, severity: 90, issues: ['dup', '  dup  ', 'unique'] }),
    ]);
    expect(r.reasons).toEqual(['[a] dup', '[a] unique']);
  });

  it('drops issues that are blank/whitespace-only', () => {
    const r = aggregateCritiques([
      verdict({ lens: 'a', pass: false, severity: 90, issues: ['   ', '', 'real'] }),
    ]);
    expect(r.reasons).toEqual(['[a] real']);
  });

  it('only pulls reasons from failing lenses, ignoring passing lenses issues', () => {
    const r = aggregateCritiques([
      verdict({ lens: 'a', pass: false, severity: 90, issues: ['fail-issue'] }),
      verdict({ lens: 'b', pass: true, issues: ['should-not-appear'] }),
    ]);
    expect(r.reasons).toEqual(['[a] fail-issue']);
  });

  it('passes when every lens passes, with zero severity and no reasons', () => {
    expect(aggregateCritiques([verdict({}), verdict({})])).toEqual({
      verdict: 'pass',
      severity: 0,
      reasons: [],
    });
  });
});
