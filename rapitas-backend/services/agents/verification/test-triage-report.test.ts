/**
 * test-triage-report.test
 *
 * Unit tests for buildTriagedTestCheck — the mapping from a triage outcome
 * (classification or null/indeterminate) to the `test` VerificationCheck.
 * Pins task 659: a null triage must open the gate (ok:true) and surface the
 * unattributed files, never masquerade as "all failures are new".
 */
import { describe, test, expect } from 'bun:test';
import { buildTriagedTestCheck } from './test-triage-report';

const base = {
  scopedFiles: ['a.test.ts', 'b.test.ts'],
  rawFailures: ['bun test --isolate a.test.ts failed:\n1 fail'],
  commandCount: 1,
  maxDetailChars: 2000,
};

describe('buildTriagedTestCheck', () => {
  test('null triage (indeterminate) opens the gate and flags the scoped files', () => {
    const check = buildTriagedTestCheck({ ...base, triage: null });
    expect(check.name).toBe('test');
    expect(check.ran).toBe(true);
    expect(check.ok).toBe(true);
    expect(check.errorCount).toBe(0);
    expect(check.indeterminate).toBe(true);
    expect(check.indeterminateFailures).toEqual(['a.test.ts', 'b.test.ts']);
    expect(check.preExistingFailures).toBeUndefined();
    expect(check.details).toContain('indeterminate');
    expect(check.details).toContain('a.test.ts, b.test.ts');
    // The raw evidence is preserved so the report still shows what actually ran red.
    expect(check.details).toContain('1 fail');
  });

  test('null triage respects maxDetailChars', () => {
    const check = buildTriagedTestCheck({ ...base, triage: null, maxDetailChars: 40 });
    expect(check.details.length).toBeLessThanOrEqual(40);
  });

  test('classified triage with new failures fails with only the new count', () => {
    const check = buildTriagedTestCheck({
      ...base,
      triage: { preExisting: ['b.test.ts'], newFailures: ['a.test.ts'] },
    });
    expect(check.ok).toBe(false);
    expect(check.errorCount).toBe(1);
    expect(check.preExistingFailures).toEqual(['b.test.ts']);
    expect(check.indeterminate).toBeUndefined();
    expect(check.indeterminateFailures).toBeUndefined();
    expect(check.details).toContain('1 fail');
  });

  test('classified triage with only pre-existing failures passes and reports the exclusion', () => {
    const check = buildTriagedTestCheck({
      ...base,
      triage: { preExisting: ['a.test.ts', 'b.test.ts'], newFailures: [] },
    });
    expect(check.ok).toBe(true);
    expect(check.errorCount).toBe(0);
    expect(check.details).toBe('1 test command(s): passed (2 pre-existing failure(s) excluded)');
    expect(check.preExistingFailures).toEqual(['a.test.ts', 'b.test.ts']);
    expect(check.indeterminate).toBeUndefined();
  });

  test('classified triage with no pre-existing failures leaves preExistingFailures undefined', () => {
    const check = buildTriagedTestCheck({
      ...base,
      triage: { preExisting: [], newFailures: ['a.test.ts'] },
    });
    expect(check.preExistingFailures).toBeUndefined();
  });
});
