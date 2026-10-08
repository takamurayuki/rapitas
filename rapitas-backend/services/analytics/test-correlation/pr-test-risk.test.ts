/**
 * pr-test-risk.test.ts
 *
 * Unit tests for services/analytics/test-correlation/pr-test-risk.ts.
 * The gh runner is always DI'd — no test invokes the real gh CLI.
 */
import { describe, test, expect, mock } from 'bun:test';
import { fetchPrChangedFiles, scorePrRisk } from './pr-test-risk';
import type { GhRunner } from './pr-test-risk';
import type { CorrelationCell } from './test-correlation.types';

function cell(overrides: Partial<CorrelationCell>): CorrelationCell {
  return {
    changedFile: 'a.ts',
    testFile: 'a.test.ts',
    correlation: 0.5,
    pValue: 0.02,
    sampleSize: 10,
    confidence: 'medium',
    nonDeterministic: false,
    ...overrides,
  };
}

describe('fetchPrChangedFiles', () => {
  test('parses gh pr view --json files output into a normalized path list', async () => {
    const runGh = mock<GhRunner>(async () =>
      JSON.stringify({ files: [{ path: 'a\\b.ts' }, { path: 'c.ts' }] }),
    );
    const files = await fetchPrChangedFiles('/repo', 42, runGh);
    expect(files).toEqual(['a/b.ts', 'c.ts']);
    expect(runGh).toHaveBeenCalledTimes(1);
    expect(runGh).toHaveBeenCalledWith(['pr', 'view', '42', '--json', 'files'], '/repo');
  });

  test('never invokes a real gh process — the runner is always the injected mock', async () => {
    const runGh = mock<GhRunner>(async () => JSON.stringify({ files: [] }));
    await fetchPrChangedFiles('/repo', 1, runGh);
    expect(runGh).toHaveBeenCalledTimes(1);
  });

  test('throws when gh returns unparsable output', async () => {
    const runGh = mock<GhRunner>(async () => JSON.stringify({ notFiles: [] }));
    await expect(fetchPrChangedFiles('/repo', 1, runGh)).rejects.toThrow();
  });
});

describe('scorePrRisk', () => {
  test('scores 0 (excluded from results) when the changed file is unrelated to any test in the matrix', () => {
    const matrix = [cell({ changedFile: 'unrelated.ts' })];
    const entries = scorePrRisk(['a.ts'], matrix);
    expect(entries).toEqual([]);
  });

  test('includes low-confidence entries with their confidence annotated, not dropped', () => {
    const matrix = [cell({ correlation: 0.7, confidence: 'low', sampleSize: 3 })];
    const entries = scorePrRisk(['a.ts'], matrix);
    expect(entries).toHaveLength(1);
    expect(entries[0].confidence).toBe('low');
    expect(entries[0].riskScore).toBeCloseTo(0.7, 10);
  });

  test('propagates the nonDeterministic flag from the source cell', () => {
    const matrix = [cell({ nonDeterministic: true })];
    const entries = scorePrRisk(['a.ts'], matrix);
    expect(entries[0].nonDeterministic).toBe(true);
  });

  test('excludes negative correlations from risk scoring', () => {
    const matrix = [cell({ correlation: -0.8 })];
    expect(scorePrRisk(['a.ts'], matrix)).toEqual([]);
  });

  test('sorts entries by riskScore descending and picks the strongest correlation per test file', () => {
    const matrix = [
      cell({ changedFile: 'a.ts', testFile: 't1.test.ts', correlation: 0.3 }),
      cell({ changedFile: 'b.ts', testFile: 't1.test.ts', correlation: 0.9 }),
      cell({ changedFile: 'a.ts', testFile: 't2.test.ts', correlation: 0.5 }),
    ];
    const entries = scorePrRisk(['a.ts', 'b.ts'], matrix);
    expect(entries.map((e) => e.testFile)).toEqual(['t1.test.ts', 't2.test.ts']);
    expect(entries[0].riskScore).toBeCloseTo(0.9, 10);
    expect(entries[0].contributingFiles).toEqual(['b.ts']);
  });
});
