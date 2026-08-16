/**
 * task-active-time ユニットテスト
 *
 * aggregateTaskActiveTime の純集計（受入2: フェーズ3回+修復再走の合算、
 * 実行中行の除外、phaseBreakdown の role×回数集約、wall-clock のサイクル分割）
 * と computeTaskActiveTime の Prisma 呼び出し形を検証する。
 */
import { describe, test, expect, mock } from 'bun:test';
import { aggregateTaskActiveTime, computeTaskActiveTime, CYCLE_GAP_MS } from './task-active-time';

// ── ヘルパー ──────────────────────────────────────────────────────────────────

const T0 = new Date('2026-08-12T00:00:00.000Z').getTime();

/** 分単位のオフセットで実行行フィクスチャを生成する。 */
function row(
  startMin: number,
  endMin: number | null,
  mode: string | null,
  status = endMin === null ? 'running' : 'completed',
) {
  return {
    startedAt: new Date(T0 + startMin * 60_000),
    completedAt: endMin === null ? null : new Date(T0 + endMin * 60_000),
    status,
    session: { mode },
  };
}

// ── aggregateTaskActiveTime() ────────────────────────────────────────────────

describe('aggregateTaskActiveTime()', () => {
  test('受入2: フェーズ3回+修復再走を含む全完了実行の和が activeTimeMs になる', () => {
    // research 10分 / plan 5分 / implement 30分 / implement再走(修復) 20分 / verify 8分
    const rows = [
      row(0, 10, 'workflow-researcher'),
      row(12, 17, 'workflow-planner'),
      row(20, 50, 'workflow-implementer'),
      row(55, 75, 'workflow-implementer', 'failed'),
      row(80, 88, 'workflow-verifier'),
    ];
    const now = new Date(T0 + 90 * 60_000);

    const result = aggregateTaskActiveTime(rows, now);

    expect(result.activeTimeMs).toBe((10 + 5 + 30 + 20 + 8) * 60_000);
  });

  test('実行中行(completedAt null)は activeTimeMs 合計に含めない（NaN混入なし）', () => {
    const rows = [
      row(0, 10, 'workflow-researcher'),
      row(12, null, 'workflow-implementer'), // 実行中
    ];
    const now = new Date(T0 + 20 * 60_000);

    const result = aggregateTaskActiveTime(rows, now);

    expect(result.activeTimeMs).toBe(10 * 60_000);
    expect(Number.isFinite(result.activeTimeMs)).toBe(true);
  });

  test('phaseBreakdown: 同 role の複数回実行は execCount と activeTimeMs を集約する', () => {
    const rows = [
      row(0, 10, 'workflow-researcher'),
      row(20, 50, 'workflow-implementer'),
      row(55, 75, 'workflow-implementer', 'failed'),
      row(80, null, 'workflow-implementer'), // 実行中: 回数に数え、時間には入れない
    ];
    const now = new Date(T0 + 85 * 60_000);

    const { phaseBreakdown } = aggregateTaskActiveTime(rows, now);

    expect(phaseBreakdown).toEqual([
      { role: 'researcher', execCount: 1, activeTimeMs: 10 * 60_000 },
      { role: 'implementer', execCount: 3, activeTimeMs: (30 + 20) * 60_000 },
    ]);
  });

  test('wallClockMs: 長い空白(CYCLE_GAP_MS超)前の放棄ランは現在サイクルに含めない', () => {
    const gapMin = CYCLE_GAP_MS / 60_000 + 60; // 閾値+1時間の空白
    const rows = [
      row(0, 30, 'workflow-researcher'), // 放棄された過去ラン
      row(gapMin + 30, gapMin + 40, 'workflow-researcher'),
      row(gapMin + 45, gapMin + 60, 'workflow-implementer'),
    ];
    const now = new Date(T0 + (gapMin + 61) * 60_000);

    const result = aggregateTaskActiveTime(rows, now);

    // wall-clock は再走サイクルの先頭(gapMin+30)→最終完了(gapMin+60)の30分
    expect(result.wallClockMs).toBe(30 * 60_000);
    // activeTimeMs は全実行の和（放棄ラン含む: 30+10+15分）
    expect(result.activeTimeMs).toBe((30 + 10 + 15) * 60_000);
  });

  test('wallClockMs: 実行中の行があれば now までを経過として扱う', () => {
    const rows = [row(0, 10, 'workflow-researcher'), row(12, null, 'workflow-implementer')];
    const now = new Date(T0 + 42 * 60_000);

    const result = aggregateTaskActiveTime(rows, now);

    expect(result.wallClockMs).toBe(42 * 60_000);
  });

  test('実行が1件もない場合はゼロ値を返す', () => {
    const result = aggregateTaskActiveTime([], new Date());

    expect(result).toEqual({ activeTimeMs: 0, wallClockMs: 0, phaseBreakdown: [] });
  });

  test('startedAt null の未開始行と負のスパン行は集計から除外する', () => {
    const rows = [
      { startedAt: null, completedAt: null, status: 'pending', session: { mode: null } },
      // 時計逆行の破損行
      {
        startedAt: new Date(T0 + 10 * 60_000),
        completedAt: new Date(T0),
        status: 'completed',
        session: { mode: 'workflow-researcher' },
      },
      row(20, 30, 'workflow-verifier'),
    ];
    const now = new Date(T0 + 31 * 60_000);

    const result = aggregateTaskActiveTime(rows, now);

    expect(result.activeTimeMs).toBe(10 * 60_000);
  });

  test('mode が workflow- 接頭辞でない/未設定の場合も安全に role 分類する', () => {
    const rows = [row(0, 5, 'single-run'), row(6, 8, null)];
    const now = new Date(T0 + 9 * 60_000);

    const { phaseBreakdown } = aggregateTaskActiveTime(rows, now);

    expect(phaseBreakdown).toEqual([
      { role: 'single-run', execCount: 1, activeTimeMs: 5 * 60_000 },
      { role: 'other', execCount: 1, activeTimeMs: 2 * 60_000 },
    ]);
  });
});

// ── computeTaskActiveTime() ──────────────────────────────────────────────────

describe('computeTaskActiveTime()', () => {
  test('taskId チェーン絞り込み + 4項目 select で findMany し、集計結果を返す', async () => {
    const findMany = mock(async () => [
      row(0, 10, 'workflow-researcher'),
      row(12, 20, 'workflow-implementer'),
    ]);
    const prisma = { agentExecution: { findMany } };

    const result = await computeTaskActiveTime(prisma as never, 560);

    expect(findMany).toHaveBeenCalledWith({
      where: { session: { config: { taskId: 560 } } },
      select: {
        startedAt: true,
        completedAt: true,
        status: true,
        session: { select: { mode: true } },
      },
      orderBy: { startedAt: 'asc' },
    });
    expect(result.activeTimeMs).toBe(18 * 60_000);
  });
});
