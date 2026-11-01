/**
 * top-level-health-route.readiness.test
 *
 * Pins the distinction `/health` was missing (#1323): a server whose port
 * answers is not necessarily a server that can be written to. Warm-up runs
 * after the listener opens, and a write landing in that window failed with
 * `SQLITE_IOERR_SHORT_READ (522)` while this endpoint reported
 * `status: "healthy", database: "connected"`.
 *
 * `status` deliberately keeps its old values. Existing waiters (dev.js,
 * restart-loop-smoke, CI) gate on `status === 'healthy'`, and warm-up can
 * outlast their timeouts — repurposing the field would turn a readiness
 * signal into a startup failure. The new truth rides on `ready`.
 *
 * Own file — mock.module is process-global.
 */
import { describe, expect, it, mock, beforeEach } from 'bun:test';

mock.module('../../config', () => ({
  prisma: { $queryRaw: mock(async () => [{ 1: 1 }]) },
}));

mock.module('../agents/system/agent-system-router', () => ({
  getAgentSystemSnapshot: mock(async () => ({
    status: 'healthy',
    activeExecutions: 0,
    runningExecutions: 0,
    interruptedExecutions: 0,
    interruptedExecutionsHistoryCount: 0,
    interruptedExecutionsDegraded: false,
    queueDepth: 0,
    activePreviewCount: 0,
  })),
}));

const { handleTopLevelHealthCheck } = await import('./top-level-health-route');
const { markWarmupComplete, markWarmupStage, resetReadinessForTests } =
  await import('../../services/system/startup-readiness');

/** The payload, failing loudly if the handler returned a 503 Response. */
async function payload(): Promise<Record<string, unknown>> {
  const result = await handleTopLevelHealthCheck();
  if (result instanceof Response) throw new Error(`expected a payload, got ${result.status}`);
  return result;
}

beforeEach(() => {
  resetReadinessForTests();
});

describe('while warm-up is still running', () => {
  it('reports ready: false', async () => {
    markWarmupStage('startup-backfills');
    const body = await payload();

    expect(body.ready).toBe(false);
  });

  it('names the warm-up task in flight', async () => {
    markWarmupStage('agent-worker-manager');
    expect((await payload()).warmupStage).toBe('agent-worker-manager');
  });

  it('still reports status healthy, so existing waiters do not break', async () => {
    markWarmupStage('memory-system');
    const body = await payload();

    expect(body.status).toBe('healthy');
    expect(body.database).toBe('connected');
  });
});

describe('once warm-up has finished', () => {
  it('reports ready: true with no stage in flight', async () => {
    markWarmupComplete();
    const body = await payload();

    expect(body.ready).toBe(true);
    expect(body.warmupStage).toBeNull();
  });

  it('keeps the fields existing consumers already read', async () => {
    markWarmupComplete();
    const body = await payload();

    for (const key of [
      'status',
      'database',
      'uptimeSeconds',
      'activeExecutions',
      'runningExecutions',
      'queueDepth',
      'activePreviewCount',
      'checkMs',
      'timestamp',
    ]) {
      expect(body).toHaveProperty(key);
    }
  });
});
