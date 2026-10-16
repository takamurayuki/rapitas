/**
 * unified-interface/utilities ユニットテスト
 *
 * getDefaultExecutionOptions のデフォルト値と mergeExecutionOptions の
 * オーバーライド・イミュータビリティを検証する。
 */
import { describe, test, expect } from 'bun:test';
import { getDefaultExecutionOptions, mergeExecutionOptions } from './utilities';

describe('getDefaultExecutionOptions', () => {
  test('returns the documented default values', () => {
    expect(getDefaultExecutionOptions()).toEqual({
      timeout: 900000,
      enableStreaming: true,
      questionTimeoutSeconds: 300,
      autoApproveFileOperations: true,
      autoApproveTerminalCommands: true,
    });
  });

  test('returns a fresh object on each call (not a shared reference)', () => {
    const a = getDefaultExecutionOptions();
    const b = getDefaultExecutionOptions();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });
});

describe('mergeExecutionOptions', () => {
  test('returns a copy of base when override is undefined', () => {
    const base = getDefaultExecutionOptions();
    const result = mergeExecutionOptions(base);
    expect(result).toEqual(base);
    expect(result).not.toBe(base);
  });

  test('override values take precedence over base', () => {
    const base = getDefaultExecutionOptions();
    const result = mergeExecutionOptions(base, { timeout: 60000, enableStreaming: false });
    expect(result.timeout).toBe(60000);
    expect(result.enableStreaming).toBe(false);
  });

  test('unset override fields fall back to base values', () => {
    const base = getDefaultExecutionOptions();
    const result = mergeExecutionOptions(base, { timeout: 60000 });
    expect(result.questionTimeoutSeconds).toBe(base.questionTimeoutSeconds);
    expect(result.autoApproveFileOperations).toBe(base.autoApproveFileOperations);
  });

  test('does not mutate the base object', () => {
    const base = getDefaultExecutionOptions();
    const baseCopy = { ...base };
    mergeExecutionOptions(base, { timeout: 1 });
    expect(base).toEqual(baseCopy);
  });

  test('an empty override object returns values equal to base', () => {
    const base = getDefaultExecutionOptions();
    const result = mergeExecutionOptions(base, {});
    expect(result).toEqual(base);
  });
});
