/**
 * pr-in-flight-wait テスト — task 1027 の競合（HTTP 側が PR 作成中に CLI 側が
 * 「PR なし」でブロック）を再現し、勝者の PR が紐付くまで待つこと、上限で諦めることを検証する。
 */
import { describe, expect, test } from 'bun:test';
import { waitForInFlightPr, PR_CREATION_IN_FLIGHT_ERROR } from './pr-in-flight-wait';

describe('waitForInFlightPr', () => {
  test('数回のポーリング後に PR が紐付けば true', async () => {
    let calls = 0;
    const slept: number[] = [];
    const ok = await waitForInFlightPr(1027, {
      timeoutMs: 60_000,
      intervalMs: 5_000,
      hasPr: async () => ++calls >= 3,
      sleep: async (ms) => {
        slept.push(ms);
      },
      now: () => 0,
    });
    expect(ok).toBe(true);
    expect(calls).toBe(3);
    expect(slept).toEqual([5_000, 5_000]);
  });

  test('期限内に紐付かなければ false', async () => {
    let t = 0;
    const ok = await waitForInFlightPr(1027, {
      timeoutMs: 20_000,
      intervalMs: 5_000,
      hasPr: async () => false,
      sleep: async (ms) => {
        t += ms;
      },
      now: () => t,
    });
    expect(ok).toBe(false);
  });

  test('探査関数の例外は「まだ無い」として扱う', async () => {
    let n = 0;
    const ok = await waitForInFlightPr(1027, {
      timeoutMs: 10_000,
      intervalMs: 1_000,
      hasPr: async () => {
        if (++n === 1) throw new Error('db');
        return true;
      },
      sleep: async () => {},
      now: () => 0,
    });
    expect(ok).toBe(true);
  });

  test('番兵文字列は auto-commit 側の文言と一致する', () => {
    expect(PR_CREATION_IN_FLIGHT_ERROR).toBe('PR作成が別プロセスで進行中のためスキップしました');
  });
});
