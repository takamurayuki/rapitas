/**
 * plan-for-verify テスト
 *
 * plan 取得の失敗が判定を揺らさず（undefined を返す）、warn が 1 回だけ出ることを検証する。
 */
import { describe, expect, test } from 'bun:test';
import { loadPlanContentForVerify } from './plan-for-verify';

describe('loadPlanContentForVerify', () => {
  test('returns the loaded plan content, calling the loader with taskId only', async () => {
    const seen: unknown[][] = [];
    const r = await loadPlanContentForVerify(7, {
      loader: async (...args: unknown[]) => {
        seen.push(args);
        return 'PLAN';
      },
    });
    expect(r).toBe('PLAN');
    expect(seen).toEqual([[7]]);
  });
  test('null from loader -> undefined', async () => {
    expect(await loadPlanContentForVerify(1, { loader: async () => null })).toBeUndefined();
  });
  test('loader throws -> undefined and exactly one warn', async () => {
    let warns = 0;
    const r = await loadPlanContentForVerify(1, {
      loader: async () => {
        throw new Error('db down');
      },
      warn: () => {
        warns++;
      },
    });
    expect(r).toBeUndefined();
    expect(warns).toBe(1);
  });
});
