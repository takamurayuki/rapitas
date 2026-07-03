/**
 * GET /agent-metrics/judge-eval route テスト
 *
 * Exercises the judge-eval read endpoint against a mocked
 * eval-judge-results module (never touches the real filesystem), covering
 * the never-run (data: null) and has-run snapshot cases.
 */
import { describe, it, expect, beforeEach, mock } from 'bun:test';
import { Elysia } from 'elysia';
import type { JudgeEvalResult } from '../../../services/observability/eval-judge-results';

const mockReadJudgeEvalResult = mock<() => JudgeEvalResult | null>(() => null);

mock.module('../../../services/observability/eval-judge-results', () => ({
  readJudgeEvalResult: mockReadJudgeEvalResult,
}));

mock.module('../../../config/database', () => ({
  ensureDatabaseConnection: () => Promise.resolve(),
  prisma: {},
}));

mock.module('../../../config/logger', () => ({
  createLogger: () => ({
    info: () => {},
    error: () => {},
    warn: () => {},
    debug: () => {},
  }),
}));

const { agentMetricsRouter } = await import('../../../routes/agents/agent-metrics/router');

describe('GET /agent-metrics/judge-eval', () => {
  let app: Elysia;

  beforeEach(() => {
    mockReadJudgeEvalResult.mockReset();
    app = new Elysia().use(agentMetricsRouter);
  });

  it('returns data: null when the eval has never run', async () => {
    mockReadJudgeEvalResult.mockReturnValue(null);

    const response = await app.handle(new Request('http://localhost/agent-metrics/judge-eval'));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ success: true, data: null });
  });

  it('returns the latest snapshot when the eval has run', async () => {
    const snapshot: JudgeEvalResult = {
      timestamp: '2026-07-02T00:00:00.000Z',
      provider: 'claude',
      correct: 5,
      total: 5,
      errored: 0,
      accuracy: 1,
      minAccuracy: 0.8,
      passed: true,
      cases: [],
    };
    mockReadJudgeEvalResult.mockReturnValue(snapshot);

    const response = await app.handle(new Request('http://localhost/agent-metrics/judge-eval'));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ success: true, data: snapshot });
  });

  it('returns success: false on an unexpected read failure', async () => {
    mockReadJudgeEvalResult.mockImplementation(() => {
      throw new Error('boom');
    });

    const response = await app.handle(new Request('http://localhost/agent-metrics/judge-eval'));

    const body = await response.json();
    expect(body).toEqual({ success: false, data: null });
  });
});
