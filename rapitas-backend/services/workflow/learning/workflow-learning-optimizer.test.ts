/**
 * workflow-learning-optimizer.test.ts
 *
 * Covers generateOptimizationRules (thin Prisma + runRuleDetection wrapper)
 * and getWorkflowRecommendation (rule matching, confidence aggregation,
 * direct-insight fallback, and duration estimation ordering). Every
 * dependency is mocked except workflow-learning-helpers, whose real
 * `matchesCondition` is exercised directly since it is pure.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import type { ComplexityAnalysisResult } from '../complexity-analyzer';

// ───────────────────────────────────────────────
// config barrel + logger
// ───────────────────────────────────────────────

const mockWorkflowLearningRecordFindMany = mock(() =>
  Promise.resolve<Array<Record<string, unknown>>>([]),
);

interface OptimizationRuleRow {
  id: number;
  condition: string;
  recommendation: string;
  confidence: number;
  description: string;
}
const mockOptimizationRuleFindMany = mock(() => Promise.resolve<OptimizationRuleRow[]>([]));
const mockOptimizationRuleUpdateMany = mock(() => Promise.resolve({ count: 0 }));

// NOTE: mirrors every runtime export of config/index.ts — mock.module is
// process-global, so a partial mock would break other test files that import
// the untouched exports later in the same bun test run.
mock.module('../../../config', () => ({
  prisma: {
    workflowLearningRecord: { findMany: mockWorkflowLearningRecordFindMany },
    workflowOptimizationRule: {
      findMany: mockOptimizationRuleFindMany,
      updateMany: mockOptimizationRuleUpdateMany,
    },
  },
  ensureDatabaseConnection: () => Promise.resolve(),
  createLogger: () => ({ info() {}, warn() {}, error() {}, debug() {}, fatal() {} }),
  logger: { info() {}, warn() {}, error() {}, debug() {}, fatal() {} },
  getDbProvider: () => 'sqlite',
  getInsensitiveMode: () => ({}),
  getProjectRoot: () => process.cwd(),
}));

mock.module('../../../config/logger', () => ({
  createLogger: () => ({ info() {}, warn() {}, error() {}, debug() {}, fatal() {} }),
  logger: { info() {}, warn() {}, error() {}, debug() {}, fatal() {} },
  getBackendLogFilePath: () => '',
}));

// ───────────────────────────────────────────────
// complexity-analyzer barrel
// ───────────────────────────────────────────────

const mockAnalyzeTaskComplexity = mock(
  (): ComplexityAnalysisResult => ({
    complexityScore: 40,
    recommendedMode: 'comprehensive',
    confidence: 0.8,
    analysisBreakdown: {
      keywordScore: 0,
      timeScore: 0,
      priorityScore: 0,
      labelScore: 0,
      scopeScore: 0,
      reasons: [],
    },
    estimatedExecutionTime: 90,
  }),
);

// NOTE: mirrors every runtime export of the complexity-analyzer barrel
// (services/workflow/complexity-analyzer.ts) so other suites importing the
// untouched exports don't break under bun's process-global mock.module.
mock.module('../complexity-analyzer', () => ({
  LIGHTWEIGHT_KEYWORDS: [],
  HEAVYWEIGHT_KEYWORDS: [],
  LIGHTWEIGHT_LABEL_KEYWORDS: [],
  HEAVYWEIGHT_LABEL_KEYWORDS: [],
  analyzeKeywords: () => ({ score: 0, reasons: [] }),
  analyzeEstimatedTime: () => ({ score: 0, reasons: [] }),
  analyzePriority: () => ({ score: 0, reasons: [] }),
  analyzeLabels: () => ({ score: 0, reasons: [] }),
  analyzeScope: () => ({ score: 0, reasons: [] }),
  getRecommendedMode: () => 'standard',
  calculateEstimatedExecutionTime: () => 90,
  calculateConfidence: () => 0.8,
  analyzeTaskComplexity: () => mockAnalyzeTaskComplexity(),
  analyzeBatchComplexity: () => [],
  getWorkflowModeConfig: () => ({}),
  analyzeTaskComplexityWithLearning: () => Promise.resolve(null),
}));

// ───────────────────────────────────────────────
// sibling learning sub-modules (workflow-learning-helpers is left real —
// its matchesCondition is pure and exercised directly)
// ───────────────────────────────────────────────

const mockEstimateDurationFromHistory = mock(() => Promise.resolve(90));
const mockGetDirectInsight = mock(() =>
  Promise.resolve<{ mode: string; reason: string } | null>(null),
);
mock.module('./workflow-learning-estimator', () => ({
  estimateDurationFromHistory: mockEstimateDurationFromHistory,
  getDirectInsight: mockGetDirectInsight,
}));

// NOTE: workflow-learning-rules.ts is deliberately NOT mocked here even
// though generateOptimizationRules calls it. It has its own dedicated
// workflow-learning-rules.test.ts exercising the real implementation, and
// mock.module()'s process-global registry means whichever file's import
// "wins" the module cache for that path depends on file execution order —
// mocking it here would silently break rules.test.ts (or vice versa) when
// both run in the same bun test invocation. generateOptimizationRules is
// instead tested via the <5-records early-return path, which never reaches
// runRuleDetection's Prisma-dependent branches.

// ───────────────────────────────────────────────
// task-resolver — mirrors every runtime export so other suites that import
// the untouched resolvers later in the same bun test run don't break.
// ───────────────────────────────────────────────

interface TaskFixture {
  title: string;
  description: string | null;
  estimatedHours: number | null;
  priority: string | null;
  themeId: number | null;
  workflowMode: string | null;
  taskLabels: Array<{ label: { name: string } }>;
}

const mockResolveTaskForLearning = mock(() => Promise.resolve<TaskFixture | null>(null));

mock.module('../../task/task-resolver', () => ({
  resolveTaskWithTheme: () => Promise.resolve(null),
  resolveTaskWithThemeAndCategory: () => Promise.resolve(null),
  resolveTaskForExecution: () => Promise.resolve(null),
  resolveTaskWorkingDirectory: () => Promise.resolve(null),
  resolveTaskWorkflowState: () => Promise.resolve(null),
  resolveTaskTitle: () => Promise.resolve(null),
  resolveTaskThemeId: () => Promise.resolve(null),
  resolveTaskForComplexityAnalysis: () => Promise.resolve(null),
  resolveTaskSubtaskInfo: () => Promise.resolve(null),
  resolveTaskForPlanApproval: () => Promise.resolve(null),
  resolveTaskForAutoMerge: () => Promise.resolve(null),
  resolveTaskForLearning: mockResolveTaskForLearning,
}));

const { generateOptimizationRules, getWorkflowRecommendation, applyModeRules } =
  await import('./workflow-learning-optimizer');

function mkTask(overrides: Partial<TaskFixture> = {}): TaskFixture {
  return {
    title: 'テストタスク',
    description: null,
    estimatedHours: null,
    priority: 'medium',
    themeId: 7,
    workflowMode: 'comprehensive',
    taskLabels: [],
    ...overrides,
  };
}

function mkRule(overrides: Partial<OptimizationRuleRow> = {}): OptimizationRuleRow {
  return {
    id: 1,
    condition: '{}',
    recommendation: JSON.stringify({ action: 'adjust_threshold', reason: 'default' }),
    confidence: 0.9,
    description: 'default rule',
    ...overrides,
  };
}

beforeEach(() => {
  mockWorkflowLearningRecordFindMany.mockReset().mockResolvedValue([]);
  mockOptimizationRuleFindMany.mockReset().mockResolvedValue([]);
  mockOptimizationRuleUpdateMany.mockReset().mockResolvedValue({ count: 0 });
  mockAnalyzeTaskComplexity.mockReset().mockReturnValue({
    complexityScore: 40,
    recommendedMode: 'comprehensive',
    confidence: 0.8,
    analysisBreakdown: {
      keywordScore: 0,
      timeScore: 0,
      priorityScore: 0,
      labelScore: 0,
      scopeScore: 0,
      reasons: [],
    },
    estimatedExecutionTime: 90,
  });
  mockEstimateDurationFromHistory.mockReset().mockResolvedValue(90);
  mockGetDirectInsight.mockReset().mockResolvedValue(null);
  mockResolveTaskForLearning.mockReset().mockResolvedValue(mkTask());
});

// ───────────────────────────────────────────────
// generateOptimizationRules
//
// Uses the real workflow-learning-rules module (see the NOTE above on why
// it isn't mocked) — exercised only via the <5-records early-return branch,
// which is deterministic and touches no Prisma calls beyond the initial
// findMany, keeping this test independent of workflow-learning-rules.test.ts.
// ───────────────────────────────────────────────

describe('generateOptimizationRules', () => {
  test('fetches the last 500 records and forwards a too-small sample to the result', async () => {
    mockWorkflowLearningRecordFindMany.mockResolvedValue([{ id: 1 }, { id: 2 }, { id: 3 }]);

    const result = await generateOptimizationRules();

    expect(mockWorkflowLearningRecordFindMany).toHaveBeenCalledWith({
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
    expect(result).toEqual({
      rulesCreated: 0,
      rulesUpdated: 0,
      rulesDeactivated: 0,
      details: ['サンプル不足: 3/5件'],
    });
  });

  test('a database error is swallowed and a zeroed result is returned', async () => {
    mockWorkflowLearningRecordFindMany.mockRejectedValue(new Error('db down'));

    const result = await generateOptimizationRules();

    expect(result).toEqual({ rulesCreated: 0, rulesUpdated: 0, rulesDeactivated: 0, details: [] });
  });
});

// ───────────────────────────────────────────────
// getWorkflowRecommendation
// ───────────────────────────────────────────────

describe('getWorkflowRecommendation — bail-out paths', () => {
  test('task not found → null', async () => {
    mockResolveTaskForLearning.mockResolvedValue(null);
    expect(await getWorkflowRecommendation(1)).toBeNull();
  });

  test('an unexpected error anywhere in the pipeline is caught and returns null', async () => {
    mockAnalyzeTaskComplexity.mockImplementation(() => {
      throw new Error('boom');
    });
    expect(await getWorkflowRecommendation(1)).toBeNull();
  });

  test('a rule-lookup database error is caught and returns null', async () => {
    mockOptimizationRuleFindMany.mockRejectedValue(new Error('fail'));
    expect(await getWorkflowRecommendation(1)).toBeNull();
  });
});

describe('getWorkflowRecommendation — no active rules match', () => {
  test('falls back to the analysis-recommended mode and default reason when no direct insight exists', async () => {
    const rec = await getWorkflowRecommendation(1);

    expect(rec).toMatchObject({
      taskId: 1,
      currentMode: 'comprehensive',
      recommendedMode: 'comprehensive',
      skipPhases: [],
      confidence: 0.5,
      reasons: ['学習データに基づく標準推奨'],
      matchedRules: [],
    });
    expect(mockGetDirectInsight).toHaveBeenCalledTimes(1);
    expect(mockOptimizationRuleUpdateMany).not.toHaveBeenCalled();
    expect(mockEstimateDurationFromHistory).toHaveBeenCalledWith(7, 'comprehensive', 40);
  });

  test('a direct insight overrides the recommended mode AND the duration estimate uses the overridden mode', async () => {
    mockGetDirectInsight.mockResolvedValue({
      mode: 'lightweight',
      reason: '同テーマの類似タスクでlightweightが成功',
    });

    const rec = await getWorkflowRecommendation(1);

    expect(rec?.recommendedMode).toBe('lightweight');
    expect(rec?.reasons).toEqual(['同テーマの類似タスクでlightweightが成功']);
    // Regression test: estimateDurationFromHistory must reflect the final
    // (post-direct-insight) mode, not the pre-insight analysis mode.
    expect(mockEstimateDurationFromHistory).toHaveBeenCalledWith(7, 'lightweight', 40);
  });

  test('currentMode falls back to "comprehensive" when the task has no workflowMode', async () => {
    mockResolveTaskForLearning.mockResolvedValue(mkTask({ workflowMode: null }));
    const rec = await getWorkflowRecommendation(1);
    expect(rec?.currentMode).toBe('comprehensive');
  });
});

describe('getWorkflowRecommendation — rule matching', () => {
  test('queries active rules with confidence >= 0.6 ordered by confidence desc', async () => {
    await getWorkflowRecommendation(1);
    expect(mockOptimizationRuleFindMany).toHaveBeenCalledWith({
      where: { isActive: true, confidence: { gte: 0.6 } },
      orderBy: { confidence: 'desc' },
    });
  });

  test('a rule whose condition does not match the task is excluded entirely', async () => {
    mockOptimizationRuleFindMany.mockResolvedValue([
      mkRule({ id: 1, condition: JSON.stringify({ themeId: 999 }) }),
    ]);

    const rec = await getWorkflowRecommendation(1);

    expect(rec?.matchedRules).toEqual([]);
    expect(mockGetDirectInsight).toHaveBeenCalledTimes(1);
    expect(mockOptimizationRuleUpdateMany).not.toHaveBeenCalled();
  });

  test('set_mode / downgrade_mode action above the 0.7 confidence gate overrides the mode and skips the direct-insight fallback', async () => {
    mockOptimizationRuleFindMany.mockResolvedValue([
      mkRule({
        id: 11,
        recommendation: JSON.stringify({
          action: 'set_mode',
          targetMode: 'lightweight',
          reason: 'r1',
        }),
        confidence: 0.9,
        description: 'd1',
      }),
    ]);

    const rec = await getWorkflowRecommendation(1);

    expect(rec?.recommendedMode).toBe('lightweight');
    expect(rec?.reasons).toEqual(['r1']);
    expect(rec?.matchedRules).toEqual([{ ruleId: 11, description: 'd1', confidence: 0.9 }]);
    expect(rec?.confidence).toBe(0.9);
    expect(mockGetDirectInsight).not.toHaveBeenCalled();

    expect(mockOptimizationRuleUpdateMany).toHaveBeenCalledTimes(1);
    const call = mockOptimizationRuleUpdateMany.mock.calls[0][0] as {
      where: { id: { in: number[] } };
      data: { lastEvaluated: Date };
    };
    expect(call.where).toEqual({ id: { in: [11] } });
    expect(call.data.lastEvaluated).toBeInstanceOf(Date);
  });

  test('a matched rule at or below the 0.7 confidence gate is recorded but does not change mode or reasons', async () => {
    mockOptimizationRuleFindMany.mockResolvedValue([
      mkRule({
        id: 12,
        recommendation: JSON.stringify({
          action: 'downgrade_mode',
          targetMode: 'standard',
          reason: 'r2',
        }),
        confidence: 0.65,
        description: 'd2',
      }),
    ]);

    const rec = await getWorkflowRecommendation(1);

    expect(rec?.recommendedMode).toBe('comprehensive');
    expect(rec?.reasons).toEqual(['学習データに基づく標準推奨']);
    expect(rec?.matchedRules).toEqual([{ ruleId: 12, description: 'd2', confidence: 0.65 }]);
  });

  test('skip_phase action above the confidence gate appends to skipPhases without altering the mode', async () => {
    mockOptimizationRuleFindMany.mockResolvedValue([
      mkRule({
        id: 13,
        recommendation: JSON.stringify({ action: 'skip_phase', phase: 'plan', reason: 'r3' }),
        confidence: 0.9,
        description: 'd3',
      }),
    ]);

    const rec = await getWorkflowRecommendation(1);

    expect(rec?.skipPhases).toEqual(['plan']);
    expect(rec?.reasons).toEqual(['r3']);
    expect(rec?.recommendedMode).toBe('comprehensive');
  });

  test('adjust_threshold action always pushes its reason, even below the 0.7 confidence gate', async () => {
    mockOptimizationRuleFindMany.mockResolvedValue([
      mkRule({
        id: 14,
        recommendation: JSON.stringify({
          action: 'adjust_threshold',
          lightweightMax: 20,
          reason: 'r4',
        }),
        confidence: 0.65,
        description: 'd4',
      }),
    ]);

    const rec = await getWorkflowRecommendation(1);

    expect(rec?.reasons).toEqual(['r4']);
  });

  test('confidence is averaged across all matched rules', async () => {
    mockOptimizationRuleFindMany.mockResolvedValue([
      mkRule({
        id: 1,
        recommendation: JSON.stringify({ action: 'adjust_threshold', reason: 'a' }),
        confidence: 0.8,
        description: 'x',
      }),
      mkRule({
        id: 2,
        recommendation: JSON.stringify({ action: 'adjust_threshold', reason: 'b' }),
        confidence: 0.6,
        description: 'y',
      }),
    ]);

    const rec = await getWorkflowRecommendation(1);

    expect(rec?.confidence).toBeCloseTo(0.7);
    expect(rec?.reasons).toEqual(['a', 'b']);
  });
});

describe('applyModeRules — 生成ルールのモード適用（作成時）', () => {
  test('高confidenceのset_modeルールが基準モードを上書きする', async () => {
    mockOptimizationRuleFindMany.mockResolvedValue([
      mkRule({
        id: 21,
        condition: JSON.stringify({ themeId: 7 }),
        recommendation: JSON.stringify({
          action: 'set_mode',
          targetMode: 'lightweight',
          reason: 'テーマ7の低複雑度は軽量で十分',
        }),
        confidence: 0.85,
      }),
    ]);

    const d = await applyModeRules({ themeId: 7 }, 30, 'standard');
    expect(d.mode).toBe('lightweight');
    expect(d.ruleIds).toEqual([21]);
    expect(d.reasons).toEqual(['テーマ7の低複雑度は軽量で十分']);
    expect(mockOptimizationRuleUpdateMany).toHaveBeenCalledTimes(1);
  });

  test('confidence 0.7以下のモードルールは適用されない', async () => {
    mockOptimizationRuleFindMany.mockResolvedValue([
      mkRule({
        id: 22,
        recommendation: JSON.stringify({
          action: 'downgrade_mode',
          targetMode: 'lightweight',
          reason: 'low-conf',
        }),
        confidence: 0.65,
      }),
    ]);

    const d = await applyModeRules({ themeId: null }, 30, 'standard');
    expect(d.mode).toBe('standard');
    expect(d.ruleIds).toHaveLength(0);
  });

  test('adjust_threshold / skip_phase はモード適用に影響しない', async () => {
    mockOptimizationRuleFindMany.mockResolvedValue([
      mkRule({
        id: 23,
        recommendation: JSON.stringify({ action: 'adjust_threshold', reason: 'x' }),
        confidence: 0.9,
      }),
      mkRule({
        id: 24,
        recommendation: JSON.stringify({ action: 'skip_phase', phase: 'plan', reason: 'y' }),
        confidence: 0.9,
      }),
    ]);

    const d = await applyModeRules({ themeId: null }, 30, 'comprehensive');
    expect(d.mode).toBe('comprehensive');
    expect(d.ruleIds).toHaveLength(0);
  });

  test('条件が合わないルールはスキップされる（themeId不一致）', async () => {
    mockOptimizationRuleFindMany.mockResolvedValue([
      mkRule({
        id: 25,
        condition: JSON.stringify({ themeId: 99 }),
        recommendation: JSON.stringify({
          action: 'set_mode',
          targetMode: 'lightweight',
          reason: 'other theme',
        }),
        confidence: 0.9,
      }),
    ]);

    const d = await applyModeRules({ themeId: 7 }, 30, 'standard');
    expect(d.mode).toBe('standard');
  });

  test('DB失敗時は基準モードのまま（best-effort）', async () => {
    mockOptimizationRuleFindMany.mockRejectedValueOnce(new Error('db down'));
    const d = await applyModeRules({ themeId: 1 }, 50, 'standard');
    expect(d.mode).toBe('standard');
    expect(d.ruleIds).toHaveLength(0);
  });
});
