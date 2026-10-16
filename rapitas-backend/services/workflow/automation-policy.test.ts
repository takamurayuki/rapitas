/**
 * automation-policy.test
 *
 * isStagedCompletionEnabled(): defaults to enabled (task 873/948 — the flag
 * must default ON so `pr`-mode completion actually waits for CI). Only an
 * explicit 'false'/'0' opts back into the legacy immediate-completion path.
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { isStagedCompletionEnabled } from './automation-policy';

describe('isStagedCompletionEnabled', () => {
  let previous: string | undefined;

  beforeEach(() => {
    previous = process.env.RAPITAS_STAGED_COMPLETION;
  });

  afterEach(() => {
    if (previous === undefined) delete process.env.RAPITAS_STAGED_COMPLETION;
    else process.env.RAPITAS_STAGED_COMPLETION = previous;
  });

  test('未設定 → true（既定で有効）', () => {
    delete process.env.RAPITAS_STAGED_COMPLETION;
    expect(isStagedCompletionEnabled()).toBe(true);
  });

  test("'false' → false", () => {
    process.env.RAPITAS_STAGED_COMPLETION = 'false';
    expect(isStagedCompletionEnabled()).toBe(false);
  });

  test("'0' → false", () => {
    process.env.RAPITAS_STAGED_COMPLETION = '0';
    expect(isStagedCompletionEnabled()).toBe(false);
  });

  test("'true' → true", () => {
    process.env.RAPITAS_STAGED_COMPLETION = 'true';
    expect(isStagedCompletionEnabled()).toBe(true);
  });

  test('任意の文字列 → true（既定側に倒す）', () => {
    process.env.RAPITAS_STAGED_COMPLETION = 'yes';
    expect(isStagedCompletionEnabled()).toBe(true);
  });
});
