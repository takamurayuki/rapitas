/**
 * prompt-size-guard tests
 *
 * Verifies the pre-flight prompt size guard used before spawning `claude --print`.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import {
  DEFAULT_MAX_PROMPT_TOKENS,
  estimateTokens,
  getMaxPromptTokens,
  guardPromptSize,
} from './prompt-size-guard';

const ENV_KEY = 'RAPITAS_AUX_AI_MAX_PROMPT_TOKENS';

afterEach(() => {
  delete process.env[ENV_KEY];
});

describe('estimateTokens', () => {
  test('returns 0 for empty input', () => {
    expect(estimateTokens('')).toBe(0);
  });

  test('is ceil(length / 2)', () => {
    expect(estimateTokens('abc')).toBe(2);
    expect(estimateTokens('日本語日本語')).toBe(3);
  });
});

describe('getMaxPromptTokens', () => {
  test('defaults when unset', () => {
    expect(getMaxPromptTokens()).toBe(DEFAULT_MAX_PROMPT_TOKENS);
  });

  test('honours a valid override', () => {
    process.env[ENV_KEY] = '1234';
    expect(getMaxPromptTokens()).toBe(1234);
  });

  test('falls back to default on invalid values', () => {
    for (const bad of ['abc', '0', '-5', '1.5', '']) {
      process.env[ENV_KEY] = bad;
      expect(getMaxPromptTokens()).toBe(DEFAULT_MAX_PROMPT_TOKENS);
    }
  });
});

describe('guardPromptSize', () => {
  test('returns the same string when under the limit', () => {
    const p = 'x'.repeat(100);
    expect(guardPromptSize(p, { maxTokens: 100 })).toBe(p);
  });

  test('keeps a prompt exactly at the limit unchanged', () => {
    const p = 'x'.repeat(200);
    expect(guardPromptSize(p, { maxTokens: 100 })).toBe(p);
  });

  test('truncates the tail when one over the limit', () => {
    const p = 'a'.repeat(201);
    const out = guardPromptSize(p, { maxTokens: 100 });
    expect(out.length).toBe(200);
    expect(p.startsWith(out)).toBe(true);
  });

  test('preserves the leading instructions and drops the tail', () => {
    const p = 'INSTRUCTION\n' + '日'.repeat(1000);
    const out = guardPromptSize(p, { maxTokens: 50 });
    expect(out.startsWith('INSTRUCTION')).toBe(true);
    expect(estimateTokens(out)).toBeLessThanOrEqual(50);
  });

  test('handles empty input', () => {
    expect(guardPromptSize('')).toBe('');
  });

  test('uses the env override when no explicit maxTokens is given', () => {
    process.env[ENV_KEY] = '10';
    expect(guardPromptSize('x'.repeat(100)).length).toBe(20);
  });
});
