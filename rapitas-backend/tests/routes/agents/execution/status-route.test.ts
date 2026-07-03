/**
 * status-route テスト
 *
 * GET /tasks/:id/execution-status が totalSessionCostUsd (AgentSession.totalCostUsd
 * のJSON化) を正しく返すことを検証する。既存の agent-execution-router.test.ts の
 * shallow smoke test は config.agentSessions を持たないモックのため none 分岐しか
 * 通らず、このフィールドを一度も検証していなかった。
 */
import { describe, it, expect, mock } from 'bun:test';
import { Elysia } from 'elysia';

// Mutable per-test fixture returned by developerModeConfig.findUnique.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mockConfig: any = null;

const mockPrisma = {
  developerModeConfig: {
    findUnique: mock(() => Promise.resolve(mockConfig)),
  },
  task: {
    findUnique: mock(() =>
      Promise.resolve({ status: 'in-progress', workflowStatus: 'in_progress' }),
    ),
    findMany: mock(() => Promise.resolve([])),
  },
  gitHubPullRequest: {
    findFirst: mock(() => Promise.resolve(null)),
  },
  agentExecution: {
    findFirst: mock(() => Promise.resolve(null)),
  },
};

mock.module('../../../../config/database', () => ({
  prisma: mockPrisma,
  ensureDatabaseConnection: () => Promise.resolve(),
}));

// NOTE: mirror ALL exports of config/logger — some sibling modules import the
// `logger` singleton directly rather than `createLogger(name)`.
mock.module('../../../../config/logger', () => {
  const noop = { info: () => {}, error: () => {}, warn: () => {}, debug: () => {} };
  return {
    createLogger: () => noop,
    logger: { ...noop, child: () => noop },
  };
});

mock.module('../../../../services/agents/agent-worker-manager', () => ({
  AgentWorkerManager: {
    getInstance: () => ({
      getQuestionTimeoutInfoAsync: mock(() => Promise.resolve(null)),
    }),
  },
}));

const { statusRoute } = await import('../../../../routes/agents/execution/status-route');

/** Build a minimal developerModeConfig fixture with one session/execution. */
function buildConfig(totalCostUsd: unknown) {
  return {
    id: 1,
    taskId: 999,
    agentSessions: [
      {
        id: 55,
        status: 'running',
        mode: 'workflow-implementer',
        totalTokensUsed: 12345,
        totalCostUsd,
        agentExecutions: [
          {
            id: 777,
            status: 'running',
            tokensUsed: 500,
            output: 'hello world',
            errorMessage: null,
            startedAt: new Date('2026-01-01T00:00:00Z'),
            completedAt: null,
            questionDetails: null,
            claudeSessionId: null,
            agentConfig: { id: 1, agentType: 'claude', name: 'Claude', modelId: 'sonnet' },
          },
        ],
      },
    ],
  };
}

describe('GET /tasks/:id/execution-status — totalSessionCostUsd', () => {
  it('surfaces the accumulated session cost as a plain number', async () => {
    mockConfig = buildConfig(0.4321);
    const app = new Elysia().use(statusRoute);
    const response = await app.handle(new Request('http://localhost/tasks/999/execution-status'));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { totalSessionCostUsd: number };
    expect(body.totalSessionCostUsd).toBeCloseTo(0.4321);
  });

  it('coerces a stringified Decimal (Prisma Decimal.toString()) to a number', async () => {
    mockConfig = buildConfig('1.5');
    const app = new Elysia().use(statusRoute);
    const response = await app.handle(new Request('http://localhost/tasks/999/execution-status'));
    const body = (await response.json()) as { totalSessionCostUsd: number };
    expect(body.totalSessionCostUsd).toBeCloseTo(1.5);
  });

  it('falls back to 0 for null/unparsable cost values instead of leaking NaN', async () => {
    mockConfig = buildConfig(null);
    const app = new Elysia().use(statusRoute);
    const response = await app.handle(new Request('http://localhost/tasks/999/execution-status'));
    const body = (await response.json()) as { totalSessionCostUsd: number };
    expect(body.totalSessionCostUsd).toBe(0);
  });
});
