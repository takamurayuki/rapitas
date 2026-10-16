/**
 * GET /learning/prompt-evolution/summary route テスト
 *
 * Exercises the read-only prompt-evolution summary endpoint against a mocked
 * services/self-learning barrel (never touches the real database), covering
 * the empty-table case and a populated summary, plus the error fallback.
 */
import { describe, it, expect, beforeEach, mock } from 'bun:test';
import { Elysia } from 'elysia';

const mockGetPromptEvolutionSummary = mock(() => Promise.resolve([] as unknown[]));

mock.module('../../../services/self-learning', () => ({
  analyzeFailure: mock(),
  extractStrategy: mock(),
  listPatterns: mock(),
  createPattern: mock(),
  recordPromptEvolution: mock(),
  getPromptEvolutionHistory: mock(),
  getPromptEvolutionSummary: mockGetPromptEvolutionSummary,
  getLearningStats: mock(),
  getGrowthTimeline: mock(),
  getMemoryOverview: mock(),
  getAverageScores: mock(),
  findSimilarEpisodes: mock(),
  getEpisodeStats: mock(),
}));

mock.module('../../../config/logger', () => ({
  createLogger: () => ({
    info: () => {},
    error: () => {},
    warn: () => {},
    debug: () => {},
  }),
}));

const { learningRoutes } = await import('../../../routes/self-learning/learning');

describe('GET /learning/prompt-evolution/summary', () => {
  let app: Elysia;

  beforeEach(() => {
    mockGetPromptEvolutionSummary.mockReset();
    app = new Elysia().use(learningRoutes);
  });

  it('returns an empty summary array when the table has no rows', async () => {
    mockGetPromptEvolutionSummary.mockResolvedValue([]);

    const response = await app.handle(
      new Request('http://localhost/learning/prompt-evolution/summary'),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ success: true, data: [] });
  });

  it('returns per-group summaries when rows exist', async () => {
    const groups = [
      {
        key: 'workflow_role_planner',
        entryCount: 3,
        pendingCount: 1,
        completedCount: 2,
        latestPerformanceDelta: 0.2,
        averagePerformanceDelta: 0.05,
        recentEntries: [],
      },
    ];
    mockGetPromptEvolutionSummary.mockResolvedValue(groups);

    const response = await app.handle(
      new Request('http://localhost/learning/prompt-evolution/summary'),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ success: true, data: groups });
  });

  it('returns success: false on an unexpected failure', async () => {
    mockGetPromptEvolutionSummary.mockImplementation(() => Promise.reject(new Error('db down')));

    const response = await app.handle(
      new Request('http://localhost/learning/prompt-evolution/summary'),
    );

    const body = await response.json();
    expect(body).toEqual({ success: false, data: [] });
  });
});
