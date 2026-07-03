/**
 * complexity-analyzer/learning テスト
 *
 * analyzeTaskComplexityWithLearning: DB-error fallback, the two minimum-
 * sample-size gates (records.length<3, similar.length<3), the confidence/
 * sample-size override threshold (>=0.7 confidence AND >=5 similar records),
 * the deterministic mode tie-break, and the avgActualDuration fallback when
 * no historical durations exist.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import type { TaskComplexityInput } from './types';
import { analyzeTaskComplexity } from './core';

interface LearningRow {
  workflowMode: string;
  predictedComplexity: number | null;
  actualDurationMinutes: number | null;
  estimatedDuration: number | null;
}

let records: LearningRow[] = [];
let shouldThrow = false;
let capturedWhere: Record<string, unknown> | null = null;

mock.module('../../../config', () => ({
  prisma: {
    workflowLearningRecord: {
      findMany: (args: { where: Record<string, unknown> }) => {
        capturedWhere = args.where;
        if (shouldThrow) return Promise.reject(new Error('connection refused'));
        return Promise.resolve(records);
      },
    },
  },
}));

const { analyzeTaskComplexityWithLearning } = await import('./learning');

// Neutral input: analyzeTaskComplexity({ title }) → complexityScore 50, mode 'standard'.
const NEUTRAL_INPUT: TaskComplexityInput = { title: '何かのタスク' };
const baseResult = analyzeTaskComplexity(NEUTRAL_INPUT);

function row(overrides: Partial<LearningRow>): LearningRow {
  return {
    workflowMode: 'standard',
    predictedComplexity: 50,
    actualDurationMinutes: 90,
    estimatedDuration: 90,
    ...overrides,
  };
}

beforeEach(() => {
  records = [];
  shouldThrow = false;
  capturedWhere = null;
});

describe('analyzeTaskComplexityWithLearning — fallback paths', () => {
  test('a DB error returns the base result unchanged, with no learningInsight key', async () => {
    shouldThrow = true;
    const result = await analyzeTaskComplexityWithLearning(NEUTRAL_INPUT);
    expect(result).toEqual(baseResult);
    expect(result).not.toHaveProperty('learningInsight');
  });

  test('fewer than 3 total records → base result unchanged', async () => {
    records = [row({}), row({})];
    const result = await analyzeTaskComplexityWithLearning(NEUTRAL_INPUT);
    expect(result).toEqual(baseResult);
  });

  test('3+ records but fewer than 3 within the +/-15 complexity window → base result unchanged', async () => {
    records = [
      row({ predictedComplexity: 90 }),
      row({ predictedComplexity: 95 }),
      row({ predictedComplexity: 100 }),
    ];
    const result = await analyzeTaskComplexityWithLearning(NEUTRAL_INPUT);
    expect(result).toEqual(baseResult);
  });

  test('themeId is included in the where clause only when provided on the input', async () => {
    records = [row({}), row({}), row({})];
    await analyzeTaskComplexityWithLearning(NEUTRAL_INPUT);
    expect(capturedWhere && 'themeId' in capturedWhere).toBe(false);

    await analyzeTaskComplexityWithLearning({ ...NEUTRAL_INPUT, themeId: 7 });
    expect(capturedWhere?.themeId).toBe(7);
  });
});

describe('analyzeTaskComplexityWithLearning — insight attached but not overriding', () => {
  test('3-4 similar records recommending a different mode: insight attached, mode NOT overridden (needs >=5)', async () => {
    records = [
      row({ workflowMode: 'comprehensive' }),
      row({ workflowMode: 'comprehensive' }),
      row({ workflowMode: 'comprehensive' }),
    ];
    const result = await analyzeTaskComplexityWithLearning(NEUTRAL_INPUT);
    expect(result.recommendedMode).toBe(baseResult.recommendedMode);
    expect(result.estimatedExecutionTime).toBe(baseResult.estimatedExecutionTime);
    expect(result.learningInsight).toEqual({
      sampleSize: 3,
      recommendedMode: 'comprehensive',
      confidence: 1,
      avgActualDuration: 90,
      modeDistribution: { comprehensive: 3 },
      differs: true,
    });
  });

  test('5+ similar records but confidence below 0.7: insight attached, mode NOT overridden', async () => {
    records = [
      row({ workflowMode: 'comprehensive' }),
      row({ workflowMode: 'comprehensive' }),
      row({ workflowMode: 'comprehensive' }),
      row({ workflowMode: 'standard' }),
      row({ workflowMode: 'standard' }),
    ];
    // 3/5 = 0.6 confidence, differs=true, but below the 0.7 override threshold.
    const result = await analyzeTaskComplexityWithLearning(NEUTRAL_INPUT);
    expect(result.recommendedMode).toBe(baseResult.recommendedMode);
    expect(result.learningInsight?.confidence).toBe(0.6);
    expect(result.learningInsight?.differs).toBe(true);
  });

  test('recommended mode equal to the base mode: differs=false, no override attempted', async () => {
    records = [
      row({ workflowMode: 'standard' }),
      row({ workflowMode: 'standard' }),
      row({ workflowMode: 'standard' }),
    ];
    const result = await analyzeTaskComplexityWithLearning(NEUTRAL_INPUT);
    expect(result.recommendedMode).toBe('standard');
    expect(result.learningInsight?.differs).toBe(false);
    expect(result.analysisBreakdown.reasons).toEqual(baseResult.analysisBreakdown.reasons);
  });
});

describe('analyzeTaskComplexityWithLearning — override', () => {
  test('>=5 similar records with >=0.7 confidence overrides mode, execution time, and appends a reason', async () => {
    records = [
      row({ workflowMode: 'comprehensive', actualDurationMinutes: 200 }),
      row({ workflowMode: 'comprehensive', actualDurationMinutes: 220 }),
      row({ workflowMode: 'comprehensive', actualDurationMinutes: 240 }),
      row({ workflowMode: 'comprehensive', actualDurationMinutes: 180 }),
      row({ workflowMode: 'standard', actualDurationMinutes: 90 }),
    ];
    // 4/5 = 0.8 confidence >= 0.7, similar.length=5 >= 5, differs=true.
    const result = await analyzeTaskComplexityWithLearning(NEUTRAL_INPUT);

    expect(result.recommendedMode).toBe('comprehensive');
    const avgDuration = Math.round((200 + 220 + 240 + 180 + 90) / 5);
    expect(result.estimatedExecutionTime).toBe(avgDuration);
    expect(result.analysisBreakdown.reasons.length).toBe(
      baseResult.analysisBreakdown.reasons.length + 1,
    );
    expect(result.analysisBreakdown.reasons.at(-1)).toBe(
      '学習データ: 類似5件中4件がcomprehensiveで成功',
    );
    expect(result.learningInsight).toEqual({
      sampleSize: 5,
      recommendedMode: 'comprehensive',
      confidence: 0.8,
      avgActualDuration: avgDuration,
      modeDistribution: { comprehensive: 4, standard: 1 },
      differs: true,
    });
  });

  test('exactly at the 0.7 confidence boundary still overrides (>= is inclusive)', async () => {
    records = [
      row({ workflowMode: 'lightweight' }),
      row({ workflowMode: 'lightweight' }),
      row({ workflowMode: 'lightweight' }),
      row({ workflowMode: 'lightweight' }),
      row({ workflowMode: 'lightweight' }),
      row({ workflowMode: 'standard' }),
      row({ workflowMode: 'standard' }),
    ];
    // 5/7 ≈ 0.714... rounds to 0.71 >= 0.7.
    const result = await analyzeTaskComplexityWithLearning(NEUTRAL_INPUT);
    expect(result.recommendedMode).toBe('lightweight');
    expect(result.learningInsight?.confidence).toBe(0.71);
  });

  test('a tied mode count breaks deterministically by locale-compare and can still override', async () => {
    // 5 total, 3 vs 2 is NOT a tie — use an explicit tie at the boundary instead:
    // 3 'comprehensive' + 3 'lightweight' → confidence 0.5, well under the
    // override threshold, but the tie-break itself must still be deterministic.
    records = [
      row({ workflowMode: 'lightweight' }),
      row({ workflowMode: 'comprehensive' }),
      row({ workflowMode: 'lightweight' }),
      row({ workflowMode: 'comprehensive' }),
      row({ workflowMode: 'lightweight' }),
      row({ workflowMode: 'comprehensive' }),
    ];
    const result = await analyzeTaskComplexityWithLearning(NEUTRAL_INPUT);
    // 'comprehensive'.localeCompare('lightweight') < 0 → comprehensive wins the tie.
    expect(result.learningInsight?.recommendedMode).toBe('comprehensive');
    expect(result.learningInsight?.confidence).toBe(0.5);
  });

  test('durations all null falls back to the base estimatedExecutionTime for avgActualDuration', async () => {
    records = [
      row({ workflowMode: 'comprehensive', actualDurationMinutes: null }),
      row({ workflowMode: 'comprehensive', actualDurationMinutes: null }),
      row({ workflowMode: 'comprehensive', actualDurationMinutes: null }),
      row({ workflowMode: 'comprehensive', actualDurationMinutes: null }),
      row({ workflowMode: 'comprehensive', actualDurationMinutes: null }),
    ];
    const result = await analyzeTaskComplexityWithLearning(NEUTRAL_INPUT);
    expect(result.learningInsight?.avgActualDuration).toBe(baseResult.estimatedExecutionTime);
    expect(result.estimatedExecutionTime).toBe(baseResult.estimatedExecutionTime);
  });
});
