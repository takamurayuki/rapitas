/**
 * workflow-learning-estimator テスト
 *
 * estimateDurationFromHistory's default-fallback / theme-scoping / proximity
 * weighting (incl. the predictedComplexity=0 and actualDurationMinutes=0
 * edge cases fixed alongside these tests — see workflow-learning-estimator.ts),
 * and getDirectInsight's minimum-sample-size gates, similarity filter, and
 * deterministic tie-break.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

interface DurationRow {
  actualDurationMinutes: number | null;
  predictedComplexity: number | null;
}
interface ThemeRow {
  workflowMode: string;
  predictedComplexity: number | null;
}

let durationRows: DurationRow[] = [];
let themeRows: ThemeRow[] = [];
let capturedWhere: Record<string, unknown> | null = null;
let capturedSelect: Record<string, unknown> | null = null;

mock.module('../../../config', () => ({
  prisma: {
    workflowLearningRecord: {
      findMany: (args: { where: Record<string, unknown>; select: Record<string, unknown> }) => {
        capturedWhere = args.where;
        capturedSelect = args.select;
        // Distinguish the two call sites by which fields they select.
        if ('workflowMode' in args.select) return Promise.resolve(themeRows);
        return Promise.resolve(durationRows);
      },
    },
  },
}));

const { estimateDurationFromHistory, getDirectInsight } =
  await import('./workflow-learning-estimator');

beforeEach(() => {
  durationRows = [];
  themeRows = [];
  capturedWhere = null;
  capturedSelect = null;
});

describe('estimateDurationFromHistory — no history', () => {
  test.each([
    ['lightweight', 20],
    ['standard', 90],
    ['comprehensive', 210],
  ])('mode=%s with zero records → static default %d', async (mode, expected) => {
    expect(await estimateDurationFromHistory(null, mode, 50)).toBe(expected);
  });

  test('an unrecognized mode with zero records falls back to 90', async () => {
    expect(await estimateDurationFromHistory(null, 'exotic-mode', 50)).toBe(90);
  });
});

describe('estimateDurationFromHistory — query scoping', () => {
  test('themeId null → where has no themeId key (cross-theme search)', async () => {
    await estimateDurationFromHistory(null, 'standard', 50);
    expect(capturedWhere).not.toBeNull();
    expect(capturedWhere && 'themeId' in capturedWhere).toBe(false);
  });

  test('themeId provided → where.themeId is set', async () => {
    await estimateDurationFromHistory(42, 'standard', 50);
    expect(capturedWhere?.themeId).toBe(42);
  });
});

describe('estimateDurationFromHistory — weighted average', () => {
  test('a single record with matching complexity is returned as-is', async () => {
    durationRows = [{ actualDurationMinutes: 120, predictedComplexity: 50 }];
    expect(await estimateDurationFromHistory(null, 'standard', 50)).toBe(120);
  });

  test('closer-complexity records are weighted more heavily than distant ones', async () => {
    durationRows = [
      { actualDurationMinutes: 100, predictedComplexity: 50 }, // diff 0, weight 1
      { actualDurationMinutes: 400, predictedComplexity: 90 }, // diff 40, weight 1/3
    ];
    const result = await estimateDurationFromHistory(null, 'standard', 50);
    const expectedWeighted = Math.round((100 * 1 + 400 * (1 / 3)) / (1 + 1 / 3));
    expect(result).toBe(expectedWeighted);
    // The close record should pull the result well below the midpoint (250).
    expect(result).toBeLessThan(250);
  });

  test('null predictedComplexity falls back to a diff of 50 (weak weight), not a crash', async () => {
    durationRows = [{ actualDurationMinutes: 60, predictedComplexity: null }];
    const result = await estimateDurationFromHistory(null, 'standard', 50);
    expect(result).toBe(60);
  });

  test('a record with actualDurationMinutes=0 is included, not silently skipped', async () => {
    // Regression test: `!r.actualDurationMinutes` would treat 0 as "missing".
    durationRows = [
      { actualDurationMinutes: 0, predictedComplexity: 50 },
      { actualDurationMinutes: 100, predictedComplexity: 50 },
    ];
    const result = await estimateDurationFromHistory(null, 'standard', 50);
    // Equal weights (both diff=0) → simple average of 0 and 100.
    expect(result).toBe(50);
  });

  test('a record with predictedComplexity=0 is weighted by its real distance, not treated as unknown', async () => {
    // Regression test: `r.predictedComplexity ? ... : 50` would treat 0 as "missing" (diff=50).
    durationRows = [{ actualDurationMinutes: 999, predictedComplexity: 0 }];
    // complexityScore=0 means diff should be 0 (exact match, weight 1), not the 50-fallback.
    const result = await estimateDurationFromHistory(null, 'standard', 0);
    expect(result).toBe(999);
  });
});

describe('getDirectInsight — bail-out gates', () => {
  test('themeId null → null without querying', async () => {
    const result = await getDirectInsight({ themeId: null, workflowMode: 'standard' }, 50);
    expect(result).toBeNull();
    expect(capturedWhere).toBeNull();
  });

  test('fewer than 3 theme records total → null', async () => {
    themeRows = [
      { workflowMode: 'standard', predictedComplexity: 50 },
      { workflowMode: 'standard', predictedComplexity: 50 },
    ];
    const result = await getDirectInsight({ themeId: 1, workflowMode: 'lightweight' }, 50);
    expect(result).toBeNull();
  });

  test('3+ records exist but fewer than 3 are within the similarity window → null', async () => {
    themeRows = [
      { workflowMode: 'standard', predictedComplexity: 50 },
      { workflowMode: 'standard', predictedComplexity: 90 },
      { workflowMode: 'standard', predictedComplexity: 95 },
    ];
    const result = await getDirectInsight({ themeId: 1, workflowMode: 'lightweight' }, 50);
    expect(result).toBeNull();
  });
});

describe('getDirectInsight — recommendation', () => {
  test('a clear majority mode different from the task’s current mode is recommended with a reason', async () => {
    themeRows = [
      { workflowMode: 'comprehensive', predictedComplexity: 50 },
      { workflowMode: 'comprehensive', predictedComplexity: 52 },
      { workflowMode: 'comprehensive', predictedComplexity: 48 },
    ];
    const result = await getDirectInsight({ themeId: 1, workflowMode: 'standard' }, 50);
    expect(result).toEqual({
      mode: 'comprehensive',
      reason: '同テーマの類似タスク3件中3件がcomprehensiveモードで成功',
    });
  });

  test('the best mode already matches the task’s current mode → null (nothing to recommend)', async () => {
    themeRows = [
      { workflowMode: 'standard', predictedComplexity: 50 },
      { workflowMode: 'standard', predictedComplexity: 52 },
      { workflowMode: 'standard', predictedComplexity: 48 },
    ];
    const result = await getDirectInsight({ themeId: 1, workflowMode: 'standard' }, 50);
    expect(result).toBeNull();
  });

  test('a tied mode count (2 vs 2) breaks deterministically by locale-compare', async () => {
    themeRows = [
      { workflowMode: 'lightweight', predictedComplexity: 50 },
      { workflowMode: 'comprehensive', predictedComplexity: 50 },
      { workflowMode: 'lightweight', predictedComplexity: 50 },
      { workflowMode: 'comprehensive', predictedComplexity: 50 },
    ];
    // 'comprehensive'.localeCompare('lightweight') < 0 → comprehensive wins the tie.
    const result = await getDirectInsight({ themeId: 1, workflowMode: 'standard' }, 50);
    expect(result?.mode).toBe('comprehensive');
    expect(result?.reason).toBe('同テーマの類似タスク4件中2件がcomprehensiveモードで成功');
  });

  test('a record with predictedComplexity=0 is still counted as similar when the task score is also near 0', async () => {
    // Regression test: `r.predictedComplexity && ...` would drop this record entirely.
    themeRows = [
      { workflowMode: 'lightweight', predictedComplexity: 0 },
      { workflowMode: 'lightweight', predictedComplexity: 5 },
      { workflowMode: 'lightweight', predictedComplexity: 8 },
    ];
    const result = await getDirectInsight({ themeId: 1, workflowMode: 'standard' }, 5);
    expect(result).toEqual({
      mode: 'lightweight',
      reason: '同テーマの類似タスク3件中3件がlightweightモードで成功',
    });
  });
});

describe('母集団のスコープ (task 667 実測)', () => {
  test('実行単位の行を母集団から除外する', async () => {
    // WorkflowLearningRecord はタスク単位と実行単位の2種類を持つ。
    // 混ぜると 31分のタスクに 1分の見積が出る（2026-08-26 実測）。
    durationRows = [{ actualDurationMinutes: 40, predictedComplexity: 50 }];

    await estimateDurationFromHistory(1, 'standard', 50);

    const where = capturedWhere as {
      estimatedDuration?: { not: null };
      complexityFactors?: { not: string };
    };
    expect(where.estimatedDuration).toEqual({ not: null });
    expect(where.complexityFactors).toEqual({ not: '{}' });
  });

  test('リードタイム時代の行を母集団から外す', async () => {
    // 旧行の actualDurationMinutes は起票からの経過時間で、待ち時間を含む。
    durationRows = [{ actualDurationMinutes: 40, predictedComplexity: 50 }];

    await estimateDurationFromHistory(1, 'standard', 50);

    const where = capturedWhere as { createdAt?: { gte: Date } };
    expect(where.createdAt?.gte).toBeInstanceOf(Date);
  });

  test('スコープを絞ってもテーマとモードの条件は残る', async () => {
    durationRows = [{ actualDurationMinutes: 40, predictedComplexity: 50 }];

    await estimateDurationFromHistory(7, 'lightweight', 20);

    const where = capturedWhere as { themeId?: number; workflowMode?: string; success?: boolean };
    expect(where.themeId).toBe(7);
    expect(where.workflowMode).toBe('lightweight');
    expect(where.success).toBe(true);
  });
});
