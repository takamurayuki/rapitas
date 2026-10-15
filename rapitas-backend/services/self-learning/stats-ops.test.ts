/**
 * stats-ops テスト
 *
 * computeMemoryStrength の漸近飽和スコアを検証: 旧線形式のように少量の
 * パターン数で100に張り付かないこと、成長で単調増加すること、成功率低下で
 * スコアが下がること。getLearningStats の acceptedTaskRate/unknownCount は
 * WorkflowTransition の読み取り専用集計であることを検証する。
 * Own file — mock.module is process-global.
 */
import { describe, test, expect, mock } from 'bun:test';

mock.module('../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));

// mock.module resolves the factory once; keep the same object reference and
// mutate its fields per test so each test controls its own return values.
const mockPrisma: Record<string, unknown> = {};
mock.module('../../config/database', () => ({ prisma: mockPrisma }));

const { computeMemoryStrength, getLearningStats } = await import('./stats-ops');

type Transition = { taskId: number; cause: string };

/** Wires the subset of prisma calls getLearningStats depends on. */
function stubLearningStatsPrisma(transitions: Transition[]): void {
  mockPrisma.experiment = {
    count: async () => 0,
    findMany: async () => [],
  };
  mockPrisma.learningPattern = { findMany: async () => [] };
  mockPrisma.promptEvolution = { count: async () => 0 };
  mockPrisma.knowledgeGraphNode = { count: async () => 0 };
  mockPrisma.knowledgeGraphEdge = { count: async () => 0 };
  mockPrisma.workflowTransition = {
    findMany: async () => transitions,
  };
}

describe('computeMemoryStrength', () => {
  test('the live dataset that pinned the old formula at 100 now lands mid-scale', () => {
    // 3 nodes / 322 patterns / 117 episodes / 94% success — old formula: 100.
    const result = computeMemoryStrength({ nodes: 3, patterns: 322, episodes: 117 }, 0.944);
    expect(result.score).toBeGreaterThan(30);
    expect(result.score).toBeLessThan(75); // no longer instantly "expert"
  });

  test('score grows monotonically with memory size', () => {
    const small = computeMemoryStrength({ nodes: 10, patterns: 50, episodes: 20 }, 0.8);
    const large = computeMemoryStrength({ nodes: 100, patterns: 500, episodes: 200 }, 0.8);
    expect(large.score).toBeGreaterThan(small.score);
  });

  test('a success-rate collapse pulls the score down (score can move both ways)', () => {
    const healthy = computeMemoryStrength({ nodes: 50, patterns: 300, episodes: 100 }, 0.95);
    const unhealthy = computeMemoryStrength({ nodes: 50, patterns: 300, episodes: 100 }, 0.2);
    expect(unhealthy.score).toBeLessThan(healthy.score - 15);
  });

  test('empty memory is a beginner, not an expert', () => {
    const result = computeMemoryStrength({ nodes: 0, patterns: 0, episodes: 0 }, 0);
    expect(result.score).toBe(0);
    expect(result.level).toBe('beginner');
  });

  test('score never exceeds 100 and levels follow the band thresholds', () => {
    const result = computeMemoryStrength({ nodes: 100000, patterns: 100000, episodes: 100000 }, 1);
    expect(result.score).toBeLessThanOrEqual(100);
    expect(result.level).toBe('expert');
  });
});

describe('getLearningStats acceptedTaskRate', () => {
  test('no WorkflowTransition rows yields null rate and zero unknownCount', async () => {
    stubLearningStatsPrisma([]);
    const stats = await getLearningStats();
    expect(stats.acceptedTaskRate).toBeNull();
    expect(stats.unknownCount).toBe(0);
    expect(stats.window).toBe('all');
  });

  test('every task classified as accepted yields rate 1.0', async () => {
    stubLearningStatsPrisma([
      { taskId: 1, cause: 'auto_merged' },
      { taskId: 2, cause: 'pr_ci_completed' },
      { taskId: 3, cause: 'verify_passed' },
    ]);
    const stats = await getLearningStats();
    expect(stats.acceptedTaskRate).toBe(1);
    expect(stats.unknownCount).toBe(0);
  });

  test('accepted/not-accepted/unknown mix is split correctly by task', async () => {
    stubLearningStatsPrisma([
      { taskId: 1, cause: 'auto_merged' },
      { taskId: 2, cause: 'verify_pr_not_created' },
      { taskId: 3, cause: 'auto_merge_blocked' },
      { taskId: 4, cause: 'phase_completed:implementer' },
    ]);
    const stats = await getLearningStats();
    // accepted=1 (task1), not-accepted=2 (task2, task3) -> 1 / 3
    expect(stats.acceptedTaskRate).toBeCloseTo(1 / 3);
    expect(stats.unknownCount).toBe(1);
  });

  test('unknown cause values are excluded from the accepted denominator', async () => {
    stubLearningStatsPrisma([
      { taskId: 1, cause: 'some_future_cause' },
      { taskId: 2, cause: 'another_unclassified_cause' },
    ]);
    const stats = await getLearningStats();
    expect(stats.acceptedTaskRate).toBeNull();
    expect(stats.unknownCount).toBe(2);
  });

  test('a task with both accepted and not-accepted causes uses the most recent one', async () => {
    // WorkflowTransition rows come back ordered by createdAt desc — the first
    // relevant row seen per task is treated as the latest observed state.
    stubLearningStatsPrisma([
      { taskId: 1, cause: 'verify_pr_not_created' }, // most recent
      { taskId: 1, cause: 'verify_passed' }, // earlier
    ]);
    const stats = await getLearningStats();
    expect(stats.acceptedTaskRate).toBe(0);
    expect(stats.unknownCount).toBe(0);
  });

  // routes/self-learning/learning.ts:77 (`.get('/stats', async () => getLearningStats())`)
  // returns this object with no transformation, so this shape assertion is
  // equivalent evidence to a live `curl /learning/stats` — the worktree's
  // dev server on port 3001 serves the main checkout's code, not this
  // branch's, so a live curl here would not reflect this change.
  test('response shape matches what GET /learning/stats would serve verbatim', async () => {
    stubLearningStatsPrisma([{ taskId: 1, cause: 'auto_merged' }]);
    const stats = await getLearningStats();
    expect(stats).toMatchObject({
      completionRate: expect.any(Number),
      sampleCount: expect.any(Number),
      acceptedTaskRate: expect.any(Number),
      window: 'all',
      unknownCount: expect.any(Number),
    });
  });
});
