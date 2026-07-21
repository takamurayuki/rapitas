/**
 * decision-trace-router.test.ts
 *
 * Unit tests for GET /agents/decision-trace via Elysia handle(): query
 * validation (taskId/executionId at least one required), normal DAG response,
 * and 500 mapping on query-layer failure. The decision-trace barrel is
 * stubbed via mock.module (process-global — run this file in isolation).
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test';

const mockGetDecisionDag = mock(() =>
  Promise.resolve({ nodes: [], edges: [] }),
) as ReturnType<typeof mock>;

// HACK(agent): bun の mock.module はプロセスグローバルなため、バレルの全エクスポートを
// ミラーしないと他 import が "export not found" をスローする。
mock.module('../../../services/observability/decision-trace', () => ({
  getDecisionDag: mockGetDecisionDag,
  recordDecision: () => Promise.resolve(),
  runConsistencyCheckBatch: () => Promise.resolve({ checked: 0, updated: 0 }),
  judgeConsistency: () => ({ consistency: 'skipped', note: '' }),
  maskSensitive: (v: unknown) => ({ masked: v, maskedFieldCount: 0 }),
  maskStringValue: (v: string) => ({ masked: v, count: 0 }),
}));

mock.module('../../../config/logger', () => {
  const noopLogger = {
    info: () => {},
    error: () => {},
    warn: () => {},
    debug: () => {},
    fatal: () => {},
  };
  return {
    createLogger: () => noopLogger,
    logger: noopLogger,
    getBackendLogFilePath: () => '/tmp/backend.log',
  };
});

const { decisionTraceRouter } = await import('./decision-trace-router');

const BASE = 'http://localhost/agents/decision-trace';

beforeEach(() => {
  mockGetDecisionDag.mockReset();
  mockGetDecisionDag.mockResolvedValue({ nodes: [], edges: [] });
});

describe('GET /agents/decision-trace', () => {
  it('returns 400 when neither taskId nor executionId is given', async () => {
    const res = await decisionTraceRouter.handle(new Request(BASE));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(mockGetDecisionDag).not.toHaveBeenCalled();
  });

  it('returns 400 for non-numeric ids', async () => {
    const res = await decisionTraceRouter.handle(new Request(`${BASE}?taskId=abc`));
    expect(res.status).toBe(400);
    expect(mockGetDecisionDag).not.toHaveBeenCalled();
  });

  it('returns the DAG for a taskId', async () => {
    const dag = {
      nodes: [{ id: 1, nodeKey: 'A' }],
      edges: [{ from: 'A', to: 'B' }],
    };
    mockGetDecisionDag.mockResolvedValueOnce(dag);
    const res = await decisionTraceRouter.handle(new Request(`${BASE}?taskId=42`));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; data: typeof dag };
    expect(body.success).toBe(true);
    expect(body.data.edges).toEqual(dag.edges);
    const arg = (mockGetDecisionDag.mock.calls[0] as unknown[])[0] as { taskId?: number };
    expect(arg.taskId).toBe(42);
  });

  it('passes executionId through to the query layer', async () => {
    const res = await decisionTraceRouter.handle(new Request(`${BASE}?executionId=7`));
    expect(res.status).toBe(200);
    const arg = (mockGetDecisionDag.mock.calls[0] as unknown[])[0] as { executionId?: number };
    expect(arg.executionId).toBe(7);
  });

  it('maps query-layer failures to 500 without leaking a throw', async () => {
    mockGetDecisionDag.mockRejectedValueOnce(new Error('query failed'));
    const res = await decisionTraceRouter.handle(new Request(`${BASE}?taskId=1`));
    expect(res.status).toBe(500);
    const body = (await res.json()) as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toBe('query failed');
  });
});
