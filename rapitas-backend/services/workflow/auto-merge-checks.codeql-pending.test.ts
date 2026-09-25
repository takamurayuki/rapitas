/**
 * auto-merge-checks CodeQL-unreported test
 *
 * Pins that a PR whose other blocking checks passed but whose CodeQL checks have not
 * been reported yet is 'pending', not 'pass' (PR #769 merged before CodeQL finished).
 */
import { describe, it, expect } from 'bun:test';
import { evaluateAutoMergeChecks, blockingChecks } from './auto-merge-checks';

const BLOCKING = new Set([
  'Test Backend',
  'CodeQL Analysis (javascript)',
  'CodeQL Analysis (typescript)',
]);

describe('evaluateAutoMergeChecks — unreported CodeQL', () => {
  it('returns "pending" when other blocking checks passed but CodeQL has not reported', () => {
    expect(evaluateAutoMergeChecks([{ name: 'Test Backend', bucket: 'pass' }], BLOCKING)).toBe(
      'pending',
    );
  });

  it('returns "pending" when only one CodeQL language has reported', () => {
    const checks = [
      { name: 'Test Backend', bucket: 'pass' },
      { name: 'CodeQL Analysis (javascript)', bucket: 'pass' },
    ];
    expect(evaluateAutoMergeChecks(checks, BLOCKING)).toBe('pending');
  });

  it('returns "fail" when CodeQL reported a failure', () => {
    const checks = [
      { name: 'Test Backend', bucket: 'pass' },
      { name: 'CodeQL Analysis (javascript)', bucket: 'fail' },
    ];
    expect(evaluateAutoMergeChecks(checks, BLOCKING)).toBe('fail');
  });

  it('returns "unknown" when nothing blocking has reported (no-CI fallback preserved)', () => {
    expect(evaluateAutoMergeChecks([], BLOCKING)).toBe('unknown');
  });

  it('returns "pass" when every blocking check including CodeQL passed', () => {
    const checks = [
      { name: 'Test Backend', bucket: 'pass' },
      { name: 'CodeQL Analysis (javascript)', bucket: 'pass' },
      { name: 'CodeQL Analysis (typescript)', bucket: 'skipping' },
    ];
    expect(evaluateAutoMergeChecks(checks, BLOCKING)).toBe('pass');
  });

  it('does not require CodeQL when an override set omits it', () => {
    expect(
      evaluateAutoMergeChecks(
        [{ name: 'Test Backend', bucket: 'pass' }],
        new Set(['Test Backend']),
      ),
    ).toBe('pass');
  });

  it('default blocking set still contains the CodeQL checks', () => {
    expect(blockingChecks().has('CodeQL Analysis (javascript)')).toBe(true);
  });
});
