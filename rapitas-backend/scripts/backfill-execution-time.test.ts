/**
 * backfill-execution-time ユニットテスト
 *
 * 対象抽出（過少方向・終端 status・閾値60s）、正常行の不変性、
 * dry-run の書き込みゼロ、--apply 時の再計算値書き込みを検証する。
 */
import { describe, test, expect, mock } from 'bun:test';
import {
  planBackfill,
  backfillExecutionTime,
  DIVERGENCE_THRESHOLD_MS,
  TARGET_STATUSES,
} from './backfill-execution-time';

const T0 = new Date('2026-08-12T00:00:00.000Z').getTime();

/** 分オフセットで候補行を生成する。 */
function candidate(id: number, startMin: number, endMin: number, executionTimeMs: number | null) {
  return {
    id,
    startedAt: new Date(T0 + startMin * 60_000),
    completedAt: new Date(T0 + endMin * 60_000),
    executionTimeMs,
  };
}

// ── planBackfill() ───────────────────────────────────────────────────────────

describe('planBackfill()', () => {
  test('executionTimeMs null / 0 の未記録行は wall スパンで補填対象になる', () => {
    expect(planBackfill(candidate(1, 0, 10, null))).toEqual({
      id: 1,
      before: null,
      after: 10 * 60_000,
    });
    expect(planBackfill(candidate(2, 0, 10, 0))).toEqual({
      id: 2,
      before: 0,
      after: 10 * 60_000,
    });
  });

  test('過少方向の乖離が閾値60sを超える行のみ対象になる', () => {
    // wall 42分に対し 13.4分しか記録なし（task 516 exec 2135 相当）→ 対象
    const wall = 42 * 60_000;
    const under = planBackfill(candidate(3, 0, 42, 13.4 * 60_000));
    expect(under).toEqual({ id: 3, before: 13.4 * 60_000, after: wall });

    // 乖離が閾値以内（CLI セグメント記録として正常）→ 不変
    expect(planBackfill(candidate(4, 0, 10, 10 * 60_000 - DIVERGENCE_THRESHOLD_MS))).toBeNull();
  });

  test('正しく記録された行・過大方向の行は不変（上書きしない）', () => {
    // 完全一致
    expect(planBackfill(candidate(5, 0, 10, 10 * 60_000))).toBeNull();
    // 過大方向（wall < recorded）— waiting_for_input セグメント累積等
    expect(planBackfill(candidate(6, 0, 10, 15 * 60_000))).toBeNull();
  });

  test('タイムスタンプ欠損・負スパンの破損行は対象外', () => {
    expect(
      planBackfill({ id: 7, startedAt: null, completedAt: new Date(), executionTimeMs: null }),
    ).toBeNull();
    expect(
      planBackfill({ id: 8, startedAt: new Date(), completedAt: null, executionTimeMs: null }),
    ).toBeNull();
    // 時計逆行
    expect(planBackfill(candidate(9, 10, 0, null))).toBeNull();
  });
});

// ── backfillExecutionTime() ──────────────────────────────────────────────────

describe('backfillExecutionTime()', () => {
  function makePrisma(rows: unknown[]) {
    return {
      agentExecution: {
        findMany: mock(async () => rows),
        update: mock(async () => ({})),
      },
    };
  }

  test('dry-run（既定）: 対象を列挙するが書き込みは 0 件', async () => {
    const prisma = makePrisma([
      candidate(1, 0, 10, null), // 対象
      candidate(2, 0, 10, 10 * 60_000), // 正常
    ]);

    const summary = await backfillExecutionTime(prisma as never, { apply: false });

    expect(summary.scanned).toBe(2);
    expect(summary.targets).toHaveLength(1);
    expect(summary.applied).toBe(0);
    expect(prisma.agentExecution.update).not.toHaveBeenCalled();
  });

  test('--apply: 対象行のみ completedAt - startedAt を書き込む', async () => {
    const prisma = makePrisma([
      candidate(1, 0, 10, null), // 対象
      candidate(2, 20, 30, 10 * 60_000), // 正常 — 不変
      candidate(3, 40, 82, 13 * 60_000), // 過少乖離 — 対象
    ]);

    const summary = await backfillExecutionTime(prisma as never, { apply: true });

    expect(summary.applied).toBe(2);
    expect(prisma.agentExecution.update).toHaveBeenCalledTimes(2);
    expect(prisma.agentExecution.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { executionTimeMs: 10 * 60_000 },
    });
    expect(prisma.agentExecution.update).toHaveBeenCalledWith({
      where: { id: 3 },
      data: { executionTimeMs: 42 * 60_000 },
    });
  });

  test('対象抽出は終端 status + 両タイムスタンプ必須で絞り込むこと', async () => {
    const prisma = makePrisma([]);

    await backfillExecutionTime(prisma as never, { apply: false });

    expect(prisma.agentExecution.findMany).toHaveBeenCalledWith({
      where: {
        status: { in: [...TARGET_STATUSES] },
        startedAt: { not: null },
        completedAt: { not: null },
      },
      select: { id: true, startedAt: true, completedAt: true, executionTimeMs: true },
      orderBy: { id: 'asc' },
    });
  });
});
