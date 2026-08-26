/**
 * research-complexity.apply.test
 *
 * Covers the prediction snapshot taken when research fixes the complexity score.
 * Separate file from research-complexity.test.ts because bun's mock.module is
 * process-global and the parser tests must keep running against the real module.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const noopLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
const findUnique = mock(
  (): Promise<Record<string, unknown> | null> =>
    Promise.resolve({ workflowModeOverride: false, workflowMode: 'comprehensive', themeId: 7 }),
);
const update = mock(() => Promise.resolve({}));

mock.module('../../config', () => ({ prisma: { task: { findUnique, update } } }));
mock.module('../../config/database', () => ({
  prisma: { task: { findUnique, update } },
  ensureDatabaseConnection: () => Promise.resolve(),
}));
mock.module('../../config/logger', () => ({
  createLogger: () => noopLogger,
  logger: noopLogger,
  getBackendLogFilePath: () => '/tmp/backend.log',
}));

const selectModeByComplexity = mock(() => Promise.resolve('standard'));
const getModeSettings = mock(() => Promise.resolve({ complexityMin: 36, complexityMax: 70 }));
mock.module('./workflow-mode-config', () => ({ selectModeByComplexity, getModeSettings }));

const estimateDurationFromHistory = mock(() => Promise.resolve(90));
mock.module('./learning/workflow-learning-estimator', () => ({ estimateDurationFromHistory }));

const recordModePrediction = mock(() => Promise.resolve());
mock.module('./learning/mode-prediction', () => ({ recordModePrediction }));

const { applyResearchAssessedComplexity } = await import('./research-complexity');

const RESEARCH = '## 複雑度評価\nスコア: 42\n';

describe('applyResearchAssessedComplexity', () => {
  beforeEach(() => {
    findUnique.mockReset().mockResolvedValue({
      workflowModeOverride: false,
      workflowMode: 'comprehensive',
      themeId: 7,
    });
    update.mockReset().mockResolvedValue({});
    recordModePrediction.mockReset().mockResolvedValue(undefined);
    estimateDurationFromHistory.mockReset().mockResolvedValue(90);
    selectModeByComplexity.mockReset().mockResolvedValue('standard');
  });

  test('snapshots the score, the mode it selected and the band that selected it', async () => {
    expect(await applyResearchAssessedComplexity(658, RESEARCH)).toEqual({
      assessed: 42,
      workflowMode: 'standard',
    });

    const p = recordModePrediction.mock.calls[0] as unknown as [number, Record<string, unknown>];
    expect(p[0]).toBe(658);
    expect(p[1]).toEqual({
      predictedComplexity: 42,
      workflowMode: 'standard',
      estimatedDurationMinutes: 90,
      thresholds: { min: 36, max: 70 },
      wasOverridden: false,
    });
  });

  test('estimates against the mode that will actually run, not the score-selected one', async () => {
    findUnique.mockResolvedValue({
      workflowModeOverride: true,
      workflowMode: 'lightweight',
      themeId: 7,
    });

    await applyResearchAssessedComplexity(658, RESEARCH);

    expect(estimateDurationFromHistory.mock.calls[0]).toEqual([7, 'lightweight', 42] as never);
    const p = recordModePrediction.mock.calls[0] as unknown as [number, Record<string, unknown>];
    expect(p[1].workflowMode).toBe('lightweight');
    expect(p[1].wasOverridden).toBe(true);
  });

  test('records a null estimate rather than a guess when history is unavailable', async () => {
    estimateDurationFromHistory.mockRejectedValue(new Error('no history'));

    await applyResearchAssessedComplexity(658, RESEARCH);

    const p = recordModePrediction.mock.calls[0] as unknown as [number, Record<string, unknown>];
    expect(p[1].estimatedDurationMinutes).toBeNull();
  });

  test('a snapshot failure never blocks the complexity write', async () => {
    recordModePrediction.mockRejectedValue(new Error('db down'));

    expect(await applyResearchAssessedComplexity(658, RESEARCH)).toEqual({
      assessed: 42,
      workflowMode: 'standard',
    });
    expect(update).toHaveBeenCalled();
  });

  test('no score means no prediction to record', async () => {
    expect(await applyResearchAssessedComplexity(658, 'スコアの記載なし')).toBeNull();
    expect(recordModePrediction).not.toHaveBeenCalled();
  });
});
