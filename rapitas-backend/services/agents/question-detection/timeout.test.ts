/**
 * question-detection/timeout ユニットテスト
 *
 * バレル(index.ts)経由のテストは detection.ts / validation.ts のみを実際に
 * 呼び出しており、timeout.ts の4関数は未検証だったため追加する。
 */
import { describe, test, expect } from 'bun:test';
import {
  normalizeTimeoutSeconds,
  calculateTimeoutDeadline,
  isQuestionTimedOut,
  getRemainingTimeoutSeconds,
} from './timeout';
import type { QuestionKey } from './types';

function makeKey(timeoutSeconds?: number): QuestionKey {
  return {
    tool: 'AskUserQuestion',
    question: 'Which option?',
    timeout_seconds: timeoutSeconds,
  } as QuestionKey;
}

describe('normalizeTimeoutSeconds', () => {
  test('returns the default (300) when undefined', () => {
    expect(normalizeTimeoutSeconds(undefined)).toBe(300);
  });

  test('returns the default (300) when null', () => {
    expect(normalizeTimeoutSeconds(null as unknown as undefined)).toBe(300);
  });

  test('clamps a value below the minimum (30) up to the minimum', () => {
    expect(normalizeTimeoutSeconds(5)).toBe(30);
  });

  test('clamps a value above the maximum (1800) down to the maximum', () => {
    expect(normalizeTimeoutSeconds(5000)).toBe(1800);
  });

  test('passes through an in-range value unchanged', () => {
    expect(normalizeTimeoutSeconds(600)).toBe(600);
  });

  test('floors a fractional in-range value', () => {
    expect(normalizeTimeoutSeconds(600.9)).toBe(600);
  });

  test('accepts the exact minimum boundary', () => {
    expect(normalizeTimeoutSeconds(30)).toBe(30);
  });

  test('accepts the exact maximum boundary', () => {
    expect(normalizeTimeoutSeconds(1800)).toBe(1800);
  });

  test('treats 0 as below the minimum and clamps it up', () => {
    expect(normalizeTimeoutSeconds(0)).toBe(30);
  });
});

describe('calculateTimeoutDeadline', () => {
  test('adds timeout_seconds (in ms) to the given start time', () => {
    const start = new Date('2026-01-01T00:00:00.000Z');
    const deadline = calculateTimeoutDeadline(makeKey(300), start);
    expect(deadline.toISOString()).toBe('2026-01-01T00:05:00.000Z');
  });

  test('falls back to DEFAULT_QUESTION_TIMEOUT_SECONDS (300) when timeout_seconds is absent', () => {
    const start = new Date('2026-01-01T00:00:00.000Z');
    const deadline = calculateTimeoutDeadline(makeKey(undefined), start);
    expect(deadline.toISOString()).toBe('2026-01-01T00:05:00.000Z');
  });

  test('defaults startTime to now when omitted', () => {
    const before = Date.now();
    const deadline = calculateTimeoutDeadline(makeKey(60));
    const after = Date.now();
    expect(deadline.getTime()).toBeGreaterThanOrEqual(before + 60_000);
    expect(deadline.getTime()).toBeLessThanOrEqual(after + 60_000);
  });
});

describe('isQuestionTimedOut', () => {
  test('returns true once the deadline has passed', () => {
    const start = new Date(Date.now() - 400_000); // 400s ago
    expect(isQuestionTimedOut(makeKey(300), start)).toBe(true);
  });

  test('returns false while still within the timeout window', () => {
    const start = new Date(Date.now() - 10_000); // 10s ago
    expect(isQuestionTimedOut(makeKey(300), start)).toBe(false);
  });

  test('returns true exactly at the deadline boundary', () => {
    const start = new Date(Date.now() - 300_000); // exactly 300s ago
    expect(isQuestionTimedOut(makeKey(300), start)).toBe(true);
  });
});

describe('getRemainingTimeoutSeconds', () => {
  test('returns a positive remaining count before the deadline', () => {
    const start = new Date();
    const remaining = getRemainingTimeoutSeconds(makeKey(300), start);
    expect(remaining).toBeGreaterThan(290);
    expect(remaining).toBeLessThanOrEqual(300);
  });

  test('returns 0 (never negative) after the deadline has passed', () => {
    const start = new Date(Date.now() - 1_000_000);
    expect(getRemainingTimeoutSeconds(makeKey(300), start)).toBe(0);
  });
});
