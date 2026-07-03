/**
 * workflow-learning-rules.test.ts
 *
 * Exercises runRuleDetection's four detection strategies (mode-downgrade,
 * phase-skip, per-theme optimal mode, complexity-threshold adjustment) via
 * mocked upsertRule/deactivateStaleRules calls, asserting which rule types
 * fire under which record distributions.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const mockUpsertRule = mock(() => Promise.resolve());
const mockDeactivateStaleRules = mock(() => Promise.resolve());

// NOTE: mirrors every runtime export of workflow-learning-helpers.ts — this
// mock.module call is process-global, so omitting an export here would break
// any other test file that imports it later in the same bun test run.
mock.module('./workflow-learning-helpers', () => ({
  upsertRule: mockUpsertRule,
  deactivateStaleRules: mockDeactivateStaleRules,
  calculatePhaseTimings: () => ({}),
  extractKeywords: () => [],
  detectSkippedPhases: () => [],
  matchesCondition: () => true,
}));

mock.module('../../../config/logger', () => ({
  createLogger: () => ({ info() {}, warn() {}, error() {}, debug() {}, fatal() {} }),
  logger: { info() {}, warn() {}, error() {}, debug() {}, fatal() {} },
  getBackendLogFilePath: () => '',
}));

const { runRuleDetection } = await import('./workflow-learning-rules');

type LearningRecord = Parameters<typeof runRuleDetection>[0][number];
type RuleGenerationResult = Parameters<typeof runRuleDetection>[1];

function freshResult(): RuleGenerationResult {
  return { rulesCreated: 0, rulesUpdated: 0, rulesDeactivated: 0, details: [] };
}

function mkRecord(overrides: Partial<LearningRecord> = {}): LearningRecord {
  return {
    workflowMode: 'comprehensive',
    actualDurationMinutes: null,
    estimatedDuration: null,
    outcome: 'success',
    success: true,
    predictedComplexity: null,
    themeId: null,
    categoryId: null,
    titleKeywords: '[]',
    wasOverridden: false,
    overriddenFrom: null,
    phaseTimings: '{}',
    skippedPhases: '[]',
    ...overrides,
  };
}

function ruleTypesCalled(): string[] {
  return mockUpsertRule.mock.calls.map((call) => call[0] as string);
}

beforeEach(() => {
  mockUpsertRule.mockClear();
  mockDeactivateStaleRules.mockClear();
});

describe('runRuleDetection — sample-size gate', () => {
  test('fewer than 5 records short-circuits before any strategy runs', async () => {
    const result = freshResult();
    await runRuleDetection([mkRecord(), mkRecord()], result);

    expect(mockUpsertRule).not.toHaveBeenCalled();
    expect(mockDeactivateStaleRules).not.toHaveBeenCalled();
    expect(result.details).toEqual(['サンプル不足: 2/5件']);
  });

  test('exactly 5 records proceeds and always runs deactivateStaleRules', async () => {
    const result = freshResult();
    await runRuleDetection(
      Array.from({ length: 5 }, () => mkRecord()),
      result,
    );

    expect(mockDeactivateStaleRules).toHaveBeenCalledTimes(1);
  });
});

describe('runRuleDetection — mode downgrade detection', () => {
  test('5+ successful overrides at ≥85% success rate produce a downgrade_mode rule', async () => {
    const downgraded = Array.from({ length: 5 }, () =>
      mkRecord({
        wasOverridden: true,
        overriddenFrom: 'comprehensive',
        success: true,
        predictedComplexity: 30,
      }),
    );
    const result = freshResult();
    await runRuleDetection(downgraded, result);

    expect(ruleTypesCalled()).toContain('downgrade_mode');
  });

  test('a low success rate among overridden records suppresses the rule', async () => {
    const records = [
      ...Array.from({ length: 5 }, () =>
        mkRecord({
          wasOverridden: true,
          overriddenFrom: 'comprehensive',
          success: true,
          predictedComplexity: 30,
        }),
      ),
      // enough failed overrides to push success rate below the 0.85 threshold
      ...Array.from({ length: 5 }, () =>
        mkRecord({
          wasOverridden: true,
          overriddenFrom: 'comprehensive',
          success: false,
          predictedComplexity: 30,
        }),
      ),
    ];
    const result = freshResult();
    await runRuleDetection(records, result);

    expect(ruleTypesCalled()).not.toContain('downgrade_mode');
  });

  test('fewer than 5 successful downgrades never triggers the rule', async () => {
    const records = [
      ...Array.from({ length: 4 }, () =>
        mkRecord({
          wasOverridden: true,
          overriddenFrom: 'comprehensive',
          success: true,
          predictedComplexity: 30,
        }),
      ),
      mkRecord(),
    ];
    const result = freshResult();
    await runRuleDetection(records, result);

    expect(ruleTypesCalled()).not.toContain('downgrade_mode');
  });

  test('all-null predictedComplexity among downgraded records suppresses the rule', async () => {
    const downgraded = Array.from({ length: 5 }, () =>
      mkRecord({
        wasOverridden: true,
        overriddenFrom: 'comprehensive',
        success: true,
        predictedComplexity: null,
      }),
    );
    const result = freshResult();
    await runRuleDetection(downgraded, result);

    expect(ruleTypesCalled()).not.toContain('downgrade_mode');
  });
});

describe('runRuleDetection — phase skip detection', () => {
  test('a phase skipped 5+ times with ≥85% success produces a skip_phase rule', async () => {
    const skipped = Array.from({ length: 5 }, () =>
      mkRecord({
        skippedPhases: JSON.stringify(['research']),
        success: true,
        predictedComplexity: 20,
      }),
    );
    const result = freshResult();
    await runRuleDetection(skipped, result);

    expect(ruleTypesCalled()).toContain('skip_phase');
  });

  test('malformed skippedPhases JSON is treated as "no skip" rather than throwing', async () => {
    const records = Array.from({ length: 5 }, () => mkRecord({ skippedPhases: '{not json' }));
    const result = freshResult();

    await expect(runRuleDetection(records, result)).resolves.toBeUndefined();
    expect(ruleTypesCalled()).not.toContain('skip_phase');
  });

  test('no predictedComplexity data among skips still fires the rule using the 35 fallback', async () => {
    const skipped = Array.from({ length: 5 }, () =>
      mkRecord({
        skippedPhases: JSON.stringify(['plan']),
        success: true,
        predictedComplexity: null,
      }),
    );
    const result = freshResult();
    await runRuleDetection(skipped, result);

    expect(ruleTypesCalled()).toContain('skip_phase');
    const planCall = mockUpsertRule.mock.calls.find((c) => (c[0] as string) === 'skip_phase');
    expect(planCall?.[1]).toContain('"predictedComplexityBelow":35');
  });
});

describe('runRuleDetection — per-theme optimal mode detection', () => {
  test('a theme with a clear best mode (not the most-used mode) produces a set_mode rule', async () => {
    const records = [
      // mostly-used mode "comprehensive": high volume but slower average duration
      ...Array.from({ length: 5 }, () =>
        mkRecord({
          themeId: 1,
          workflowMode: 'comprehensive',
          success: true,
          actualDurationMinutes: 200,
        }),
      ),
      // less-used mode "lightweight": faster, still meets the success threshold
      ...Array.from({ length: 3 }, () =>
        mkRecord({
          themeId: 1,
          workflowMode: 'lightweight',
          success: true,
          actualDurationMinutes: 10,
        }),
      ),
    ];
    const result = freshResult();
    await runRuleDetection(records, result);

    expect(ruleTypesCalled()).toContain('adjust_time');
  });

  test('when the best-scoring mode is also the most-used mode, no rule fires', async () => {
    const records = Array.from({ length: 6 }, () =>
      mkRecord({ themeId: 2, workflowMode: 'standard', success: true, actualDurationMinutes: 60 }),
    );
    const result = freshResult();
    await runRuleDetection(records, result);

    expect(ruleTypesCalled()).not.toContain('adjust_time');
  });

  test('themes with fewer than 5 records are skipped entirely', async () => {
    const records = [
      ...Array.from({ length: 3 }, () =>
        mkRecord({ themeId: 3, workflowMode: 'lightweight', success: true }),
      ),
      ...Array.from({ length: 2 }, () => mkRecord({ themeId: 4 })),
    ];
    const result = freshResult();
    await runRuleDetection(records, result);

    expect(ruleTypesCalled()).not.toContain('adjust_time');
  });

  test('records with a null themeId are excluded from per-theme grouping', async () => {
    const records = Array.from({ length: 5 }, () => mkRecord({ themeId: null }));
    const result = freshResult();
    await runRuleDetection(records, result);

    expect(ruleTypesCalled()).not.toContain('adjust_time');
  });

  test('a mode with fewer than 3 samples within a theme is not eligible as best mode', async () => {
    const records = [
      ...Array.from({ length: 5 }, () =>
        mkRecord({
          themeId: 5,
          workflowMode: 'comprehensive',
          success: true,
          actualDurationMinutes: 200,
        }),
      ),
      // only 2 samples of "lightweight" — below the per-mode eligibility floor of 3
      ...Array.from({ length: 2 }, () =>
        mkRecord({
          themeId: 5,
          workflowMode: 'lightweight',
          success: true,
          actualDurationMinutes: 5,
        }),
      ),
    ];
    const result = freshResult();
    await runRuleDetection(records, result);

    expect(ruleTypesCalled()).not.toContain('adjust_time');
  });
});

describe('runRuleDetection — complexity threshold adjustment', () => {
  test('3+ lightweight failures with a low median complexity produce an upgrade_mode rule', async () => {
    const records = [
      ...Array.from({ length: 3 }, () =>
        mkRecord({
          workflowMode: 'lightweight',
          success: false,
          wasOverridden: false,
          predictedComplexity: 20,
        }),
      ),
      mkRecord(),
      mkRecord(),
    ];
    const result = freshResult();
    await runRuleDetection(records, result);

    expect(ruleTypesCalled()).toContain('upgrade_mode');
  });

  test('fewer than 3 lightweight failures never triggers the threshold rule', async () => {
    const records = [
      ...Array.from({ length: 2 }, () =>
        mkRecord({ workflowMode: 'lightweight', success: false, predictedComplexity: 20 }),
      ),
      mkRecord(),
      mkRecord(),
      mkRecord(),
    ];
    const result = freshResult();
    await runRuleDetection(records, result);

    expect(ruleTypesCalled()).not.toContain('upgrade_mode');
  });

  test('overridden lightweight failures are excluded from the failure set', async () => {
    const records = [
      ...Array.from({ length: 3 }, () =>
        mkRecord({
          workflowMode: 'lightweight',
          success: false,
          wasOverridden: true,
          predictedComplexity: 20,
        }),
      ),
      mkRecord(),
      mkRecord(),
    ];
    const result = freshResult();
    await runRuleDetection(records, result);

    expect(ruleTypesCalled()).not.toContain('upgrade_mode');
  });

  test('a median complexity above 35 does not trigger a downward threshold adjustment', async () => {
    const records = [
      ...Array.from({ length: 3 }, () =>
        mkRecord({ workflowMode: 'lightweight', success: false, predictedComplexity: 60 }),
      ),
      mkRecord(),
      mkRecord(),
    ];
    const result = freshResult();
    await runRuleDetection(records, result);

    expect(ruleTypesCalled()).not.toContain('upgrade_mode');
  });

  test('the new threshold floors at 15 even for a very low median complexity', async () => {
    const records = [
      ...Array.from({ length: 3 }, () =>
        mkRecord({ workflowMode: 'lightweight', success: false, predictedComplexity: 5 }),
      ),
      mkRecord(),
      mkRecord(),
    ];
    const result = freshResult();
    await runRuleDetection(records, result);

    const call = mockUpsertRule.mock.calls.find((c) => (c[0] as string) === 'upgrade_mode');
    expect(call?.[1]).toContain('"failureComplexityMedian":5');
    const recommendation = call?.[2] as string;
    expect(recommendation).toContain('lightweightMax');
    expect(JSON.parse(recommendation).lightweightMax).toBe(15);
  });
});
