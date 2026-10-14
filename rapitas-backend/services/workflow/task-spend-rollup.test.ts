/**
 * task-spend-rollup.test
 *
 * 実測した多重計上の再現（2026-10-13）。
 *
 * `AgentExecution.costUsd` は Claude CLI の `total_cost_usd` をそのまま保存した
 * もので、これは**セッション累計**である。`--resume` で同じセッションを続けると
 * 毎回それまでの合計が入るため、実行ごとに合算すると修復周回の分が何重にも
 * 数えられる。
 *
 * CLI の実測（haiku、同一 session_id）:
 *   1回目（新規）  total_cost_usd 0.00257  num_turns 1
 *   2回目（resume）total_cost_usd 0.00456  num_turns 1
 * 合算すると 0.00713。実際のセッション総額は 0.00456。
 *
 * DB の実測（正しい join で 4,087 実行）:
 *   #980  naive \$134.19 → 真 \$24.02（5.59倍）
 *   #1214 naive \$44.95  → 真 \$14.83（3.03倍）
 *   予算 \$25 を超えたとして halt された 2 件はいずれも誤りだった:
 *     #1160 naive \$25.69 → 真 \$13.13（予算の53%）
 *     #1174 naive \$27.05 → 真 \$17.96（予算の72%）
 *
 * 一方、同じ claudeSessionId で値が**下がる**ケースが 331 セッション中 176 件
 * あり（例 4.32 → 1.05）、「セッション内の最大値」では正しくならない。下降は
 * 新しいチェーンの開始として扱う必要がある。
 */
import { describe, expect, test } from 'bun:test';
import { rollUpTaskSpend, type SpendRow } from './task-spend-rollup';

/** Shorthand for a row. */
const row = (costUsd: number, claudeSessionId: string | null, startedAt?: Date): SpendRow => ({
  costUsd,
  claudeSessionId,
  startedAt: startedAt ?? null,
});

describe('rollUpTaskSpend', () => {
  test('セッションの無い単発実行はそのまま合算する', () => {
    expect(rollUpTaskSpend([row(1.5, null), row(2.25, null)], null)).toBeCloseTo(3.75, 6);
  });

  test('別セッションどうしは合算する', () => {
    expect(rollUpTaskSpend([row(1.5, 'a'), row(2.25, 'b')], null)).toBeCloseTo(3.75, 6);
  });

  // この欠陥の核心。CLI の実測値そのまま。
  test('実測: 同一セッションの累計値を二重に数えない', () => {
    expect(rollUpTaskSpend([row(0.00257, 's1'), row(0.00456, 's1')], null)).toBeCloseTo(0.00456, 8);
  });

  // #1214 の実測チェーン（5ad76864 の 5 回）。
  test('実測 #1214: 累計チェーンはその最終額になる', () => {
    const chain = [1.94, 4.2, 5.97, 6.45, 8.86].map((c) => row(c, '5ad76864'));
    expect(rollUpTaskSpend(chain, null)).toBeCloseTo(8.86, 6);
  });

  // 331 セッション中 176 件で値が下がる。max では取りこぼす。
  test('値が下がったら新しいチェーンとして数える（max では足りない）', () => {
    expect(rollUpTaskSpend([row(4.32, 's1'), row(1.05, 's1')], null)).toBeCloseTo(5.37, 6);
  });

  test('下降後に再び上昇するチェーンも増分で数える', () => {
    // 4.32（チェーン1）+ 1.05 → 3.00（チェーン2 は 3.00 まで伸びた）
    expect(rollUpTaskSpend([row(4.32, 's1'), row(1.05, 's1'), row(3.0, 's1')], null)).toBeCloseTo(
      7.32,
      6,
    );
  });

  test('同額の繰り返しは増分 0 として扱う', () => {
    expect(rollUpTaskSpend([row(2.0, 's1'), row(2.0, 's1'), row(2.0, 's1')], null)).toBeCloseTo(
      2.0,
      6,
    );
  });

  test('時刻順に並べ替えてから増分を取る（取得順に依存しない）', () => {
    const late = row(8.86, 's1', new Date('2026-10-13T03:00:00Z'));
    const early = row(1.94, 's1', new Date('2026-10-13T01:00:00Z'));
    expect(rollUpTaskSpend([late, early], null)).toBeCloseTo(8.86, 6);
  });

  describe('窓（since）', () => {
    const chain = [
      row(1.94, 's1', new Date('2026-10-13T01:00:00Z')),
      row(4.2, 's1', new Date('2026-10-13T02:00:00Z')),
      row(8.86, 's1', new Date('2026-10-13T03:00:00Z')),
    ];

    // 窓の前の分を持ち込まないことが要点。ここを間違えると、
    // 一度上限を超えたタスクが再開後すぐ再 halt される（task 996 の形）。
    test('窓内の増分だけを数える（窓前の累計を持ち込まない）', () => {
      expect(rollUpTaskSpend(chain, new Date('2026-10-13T02:30:00Z'))).toBeCloseTo(4.66, 6);
    });

    test('窓が全体を含むならチェーン全額', () => {
      expect(rollUpTaskSpend(chain, new Date('2026-10-13T00:00:00Z'))).toBeCloseTo(8.86, 6);
    });

    test('窓が全体より後なら 0', () => {
      expect(rollUpTaskSpend(chain, new Date('2026-10-13T04:00:00Z'))).toBe(0);
    });

    // 開始時刻の無い行は「これから走る」もので、古い行ではない。
    test('startedAt が無い行は窓内として数える', () => {
      expect(rollUpTaskSpend([row(3.0, null, undefined)], new Date('2026-10-13T04:00:00Z'))).toBe(
        3,
      );
    });
  });

  test('負値や NaN は 0 として扱う', () => {
    expect(rollUpTaskSpend([row(-5, 'a'), row(Number.NaN, 'b'), row(2, 'c')], null)).toBeCloseTo(
      2,
      6,
    );
  });

  test('空なら 0', () => {
    expect(rollUpTaskSpend([], null)).toBe(0);
  });
});
