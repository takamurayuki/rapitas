/**
 * research-complexity.escalation.test
 *
 * The mode applied after research is not complexity alone: a lightweight
 * score with something research could not settle gains the plan phase. Task
 * 1508 (score 18) is the reproduction — open items in research.md and a
 * failed research critic, yet it ran without a planner.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const noopLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
const findUnique = mock(
  (): Promise<Record<string, unknown> | null> =>
    Promise.resolve({ workflowModeOverride: false, workflowMode: 'lightweight', themeId: 1 }),
);
const update = mock((_a: unknown) => Promise.resolve({}));
let causes: Array<{ cause: string }> = [];
const findMany = mock(() => Promise.resolve(causes));
const prisma = { task: { findUnique, update }, workflowTransition: { findMany } };

mock.module('../../config', () => ({ prisma }));
mock.module('../../config/database', () => ({
  prisma,
  ensureDatabaseConnection: () => Promise.resolve(),
}));
mock.module('../../config/logger', () => ({
  createLogger: () => noopLogger,
  logger: noopLogger,
  getBackendLogFilePath: () => '/tmp/backend.log',
}));
mock.module('./workflow-mode-config', () => ({
  selectModeByComplexity: () => Promise.resolve('lightweight'),
  getModeSettings: () => Promise.resolve({ isEnabled: true, complexityMin: 0, complexityMax: 35 }),
}));
mock.module('./learning/workflow-learning-estimator', () => ({
  estimateDurationFromHistory: () => Promise.resolve(60),
}));
mock.module('./learning/mode-prediction', () => ({
  recordModePrediction: () => Promise.resolve(),
}));

const { applyResearchAssessedComplexity } = await import('./research-complexity');

const research = (open: string) =>
  `## 未確定事項（プランナーが解決すべき項目）\n${open}\n\n## 複雑度評価\nスコア: 18\n`;
const writtenMode = () =>
  (update.mock.calls.at(-1)?.[0] as { data?: { workflowMode?: string } } | undefined)?.data
    ?.workflowMode;

describe('applyResearchAssessedComplexity — escalation on uncertainty', () => {
  beforeEach(() => {
    causes = [];
    update.mockClear();
    findUnique.mockResolvedValue({
      workflowModeOverride: false,
      workflowMode: 'lightweight',
      themeId: 1,
    });
  });

  test('open items in research.md promote a lightweight score to standard', async () => {
    const r = await applyResearchAssessedComplexity(1508, research('- A を確かめる'));
    expect(r.workflowMode).toBe('standard');
    expect(writtenMode()).toBe('standard');
  });

  test('a failed research critic promotes it too', async () => {
    causes = [{ cause: 'research_critic_failed' }];
    const r = await applyResearchAssessedComplexity(1508, research('なし'));
    expect(r.workflowMode).toBe('standard');
  });

  test('nothing open keeps lightweight', async () => {
    const r = await applyResearchAssessedComplexity(1508, research('なし'));
    expect(r.workflowMode).toBe('lightweight');
    expect(writtenMode()).toBeUndefined();
  });

  test('a user-pinned mode is never escalated', async () => {
    findUnique.mockResolvedValue({
      workflowModeOverride: true,
      workflowMode: 'lightweight',
      themeId: 1,
    });
    causes = [{ cause: 'research_critic_failed' }];
    const r = await applyResearchAssessedComplexity(1508, research('- A'));
    expect(r.workflowMode).toBeNull();
    expect(writtenMode()).toBeUndefined();
  });
});
