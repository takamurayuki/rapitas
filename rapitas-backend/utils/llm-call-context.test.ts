/**
 * LLM Call Context ユニットテスト
 *
 * withLlmCallScope / incrementLlmCall / getLlmCallCount の
 * スコープ分離・ネスト・スコープ外no-op を検証する。
 */
import { describe, expect, test } from 'bun:test';
import { withLlmCallScope, incrementLlmCall, getLlmCallCount } from './llm-call-context';

describe('withLlmCallScope / incrementLlmCall', () => {
  test('スコープ内で incrementLlmCall を呼ぶとカウントが増える', async () => {
    const result = await withLlmCallScope(async () => {
      incrementLlmCall();
      incrementLlmCall();
      return getLlmCallCount();
    });
    expect(result).toBe(2);
  });

  test('スコープ外で incrementLlmCall を呼んでもカウントされない (no-op)', () => {
    incrementLlmCall(); // outside any scope — must be no-op
    expect(getLlmCallCount()).toBe(0);
  });

  test('スコープ終了後は getLlmCallCount が 0 を返す', async () => {
    await withLlmCallScope(async () => {
      incrementLlmCall();
    });
    // After scope exits, the store is gone → falls back to 0
    expect(getLlmCallCount()).toBe(0);
  });

  test('ネストした独立スコープはそれぞれ独立したカウンタを持つ', async () => {
    const [outer, inner] = await withLlmCallScope(async () => {
      incrementLlmCall(); // outer +1

      const innerCount = await withLlmCallScope(async () => {
        incrementLlmCall(); // inner +1
        incrementLlmCall(); // inner +2
        return getLlmCallCount();
      });

      // outer count should be unaffected by the nested scope
      return [getLlmCallCount(), innerCount];
    });

    expect(outer).toBe(1);
    expect(inner).toBe(2);
  });

  test('スコープなしでの getLlmCallCount は常に 0', () => {
    expect(getLlmCallCount()).toBe(0);
  });

  test('並列スコープはそれぞれ独立したカウンタを持つ', async () => {
    const [a, b] = await Promise.all([
      withLlmCallScope(async () => {
        incrementLlmCall();
        await new Promise((r) => setTimeout(r, 10));
        incrementLlmCall();
        return getLlmCallCount();
      }),
      withLlmCallScope(async () => {
        incrementLlmCall();
        await new Promise((r) => setTimeout(r, 5));
        return getLlmCallCount();
      }),
    ]);

    expect(a).toBe(2);
    expect(b).toBe(1);
  });
});
