/**
 * case-schema.test
 *
 * Validates the EvalCase schema guard used by eval-runner.ts and
 * eval-collect-cases.ts.
 */
import { describe, it, expect } from 'bun:test';
import { validateEvalCase } from './case-schema';

const VALID = {
  id: 'case-1',
  category: 'bug-fix',
  taskDescription: 'desc',
  initialFiles: ['a.ts'],
  acceptanceCheck: 'bun test a.test.ts',
  expectedOutcome: 'fail-to-pass',
};

describe('validateEvalCase', () => {
  it('accepts a fully valid case', () => {
    expect(validateEvalCase(VALID).ok).toBe(true);
  });

  it('rejects a non-object value', () => {
    const result = validateEvalCase('not an object');
    expect(result.ok).toBe(false);
  });

  it('rejects an unknown category', () => {
    const result = validateEvalCase({ ...VALID, category: 'unknown-category' });
    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('category'))).toBe(true);
  });

  it('rejects a non-array initialFiles', () => {
    const result = validateEvalCase({ ...VALID, initialFiles: 'not-an-array' });
    expect(result.ok).toBe(false);
  });

  it('rejects an invalid expectedOutcome', () => {
    const result = validateEvalCase({ ...VALID, expectedOutcome: 'maybe' });
    expect(result.ok).toBe(false);
  });

  it('collects multiple errors at once', () => {
    const result = validateEvalCase({});
    expect(result.ok).toBe(false);
    expect(result.errors.length).toBeGreaterThan(1);
  });
});
