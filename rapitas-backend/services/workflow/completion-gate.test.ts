/**
 * completion-gate.test — shouldDeferCompletionForCi
 *
 * task 950: a `pr`-mode task used to complete immediately after PR creation,
 * before CI ever ran. Covers only the new CI-defer decision; the existing
 * verifyJustifiesNoChange / researchConcludesNoChange / evaluateCompletionGate
 * exports are covered elsewhere (see tests/services/research-no-change.test.ts).
 */
import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { shouldDeferCompletionForCi } from './completion-gate';

describe('shouldDeferCompletionForCi', () => {
  const original = process.env.RAPITAS_STAGED_COMPLETION;
  beforeEach(() => {
    delete process.env.RAPITAS_STAGED_COMPLETION;
  });
  afterEach(() => {
    if (original === undefined) delete process.env.RAPITAS_STAGED_COMPLETION;
    else process.env.RAPITAS_STAGED_COMPLETION = original;
  });

  test('merge mode defers completion until CI/merge resolves', () => {
    expect(shouldDeferCompletionForCi('merge')).toBe(true);
  });

  test('pr mode defers completion until CI goes green (staged completion default ON)', () => {
    expect(shouldDeferCompletionForCi('pr')).toBe(true);
  });

  test('none mode completes immediately (no PR to wait on)', () => {
    expect(shouldDeferCompletionForCi('none')).toBe(false);
  });

  test('commit mode completes immediately (direct commit, no PR)', () => {
    expect(shouldDeferCompletionForCi('commit')).toBe(false);
  });

  test('pr mode completes immediately when RAPITAS_STAGED_COMPLETION=false (task 948 escape hatch)', () => {
    process.env.RAPITAS_STAGED_COMPLETION = 'false';
    expect(shouldDeferCompletionForCi('pr')).toBe(false);
  });

  test('merge mode still defers even when RAPITAS_STAGED_COMPLETION=false — a merge outcome always needs confirming', () => {
    process.env.RAPITAS_STAGED_COMPLETION = 'false';
    expect(shouldDeferCompletionForCi('merge')).toBe(true);
  });
});
