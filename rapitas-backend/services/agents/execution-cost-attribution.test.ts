/**
 * execution-cost-attribution.test
 *
 * `AgentExecution.costUsd` は Claude CLI の `total_cost_usd` をそのまま保存した
 * 値で、これはセッション累計。行ごとに合算すると `--resume` のたびに同じ金額が
 * 何度も数えられる。CLI 直接実測（haiku・同一 session_id・num_turns いずれも1）:
 * 新規 0.00257 → resume 0.00456。合算 0.00713 に対し実額 0.00456。
 *
 * ここは「各行が自分の増分だけを持つ」形に直す共通部分。task-budget（タスクの
 * halt とモデル降格）と smart-model-router（週次予算）の両方が使う。
 */
import { describe, expect, test } from 'bun:test';
import {
  attributeIncrementalCosts,
  coerceRecordedCost,
  sumAttributedSpend,
  type CostRow,
} from './execution-cost-attribution';

const row = (costUsd: unknown, claudeSessionId: string | null, startedAt?: Date): CostRow => ({
  costUsd,
  claudeSessionId,
  startedAt: startedAt ?? null,
});

describe('coerceRecordedCost', () => {
  test.each([
    [1.5, 1.5],
    ['2.25', 2.25],
    // Prisma Decimal arrives as an object whose String() is the number; legacy
    // rows carry a double-JSON-encoded string.
    ['"3.25"', 3.25],
    [null, 0],
    [undefined, 0],
    ['n/a', 0],
    [-4, 0],
    [Number.NaN, 0],
  ])('%p -> %p', (input, expected) => {
    expect(coerceRecordedCost(input)).toBe(expected);
  });
});

describe('attributeIncrementalCosts', () => {
  test('セッションの無い行はそのままの額', () => {
    expect(attributeIncrementalCosts([row(1.5, null), row(2.25, null)])).toEqual([1.5, 2.25]);
  });

  // #1214 の実測チェーン（claudeSessionId 5ad76864、5実行）。
  test('実測: 累計チェーンは増分に分解される', () => {
    const chain = [1.94, 4.2, 5.97, 6.45, 8.86].map((c) => row(c, '5ad76864'));
    const inc = attributeIncrementalCosts(chain);
    expect(inc.map((n) => Number(n.toFixed(2)))).toEqual([1.94, 2.26, 1.77, 0.48, 2.41]);
    expect(inc.reduce((a, b) => a + b, 0)).toBeCloseTo(8.86, 6);
  });

  test('入力の順序に合わせて返す（時刻順に並べ替えても対応が崩れない）', () => {
    const late = row(8.86, 's1', new Date('2026-10-13T03:00:00Z'));
    const early = row(1.94, 's1', new Date('2026-10-13T01:00:00Z'));
    // 入力は [late, early] の順。増分は時刻順に計算し、返り値は入力順に戻す。
    expect(attributeIncrementalCosts([late, early])).toEqual([6.92, 1.94]);
  });

  // 331 セッション中 176 件で値が下降する（id 再利用による新チェーン）。
  test('下降した行は新しいチェーンとして全額', () => {
    expect(attributeIncrementalCosts([row(4.32, 's1'), row(1.05, 's1')])).toEqual([4.32, 1.05]);
  });

  test('同額の繰り返しは増分 0（同じ累計の再報告）', () => {
    expect(attributeIncrementalCosts([row(2, 's1'), row(2, 's1')])).toEqual([2, 0]);
  });

  test('別セッションどうしは互いに影響しない', () => {
    const inc = attributeIncrementalCosts([row(5, 'a'), row(2, 'b'), row(7, 'a')]);
    expect(inc).toEqual([5, 2, 2]);
  });

  test('空なら空', () => {
    expect(attributeIncrementalCosts([])).toEqual([]);
  });
});

describe('sumAttributedSpend', () => {
  test('記録のある行は増分、記録の無い行は推定にフォールバックする', () => {
    const rows = [row(1.94, 's1'), row(8.86, 's1'), row(null, null)];
    expect(sumAttributedSpend(rows, () => 0.5)).toBeCloseTo(8.86 + 0.5, 6);
  });

  // 増分 0 は「同じ累計の再報告」であって「記録が無い」ではない。ここを
  // 取り違えると、再報告のたびにトークン推定が足し込まれてしまう。
  test('増分 0 の行を推定にフォールバックさせない', () => {
    const rows = [row(2, 's1'), row(2, 's1')];
    expect(sumAttributedSpend(rows, () => 99)).toBe(2);
  });

  test('推定関数にはその行が渡る', () => {
    const seen: unknown[] = [];
    sumAttributedSpend([row(null, null), row(3, 's1')], (r) => {
      seen.push(r.claudeSessionId);
      return 1;
    });
    expect(seen).toEqual([null]);
  });
});
