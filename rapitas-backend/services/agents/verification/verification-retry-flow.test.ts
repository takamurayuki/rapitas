/**
 * verification-retry-flow.test
 *
 * Fault-injection tests for `retryOrBlock`'s DB-driven paths (not covered by
 * verification-retry.test.ts, which only tests the pure helpers):
 *
 * 1. A session-metadata READ failure must not silently reset the self-repair
 *    attempt counter to 1 — that would let the loop bypass `maxRetries` on
 *    repeated DB hiccups (same loop-budget-bypass class as the already-hardened
 *    counter-persist check in the same function).
 * 2. A rejected self-repair relaunch (the fire-and-forget `executeTask(...)`
 *    call) must not leave the task/session stuck `running` forever with only
 *    a log line — it must block instead.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const sessionFindUnique = mock(() => Promise.resolve({ metadata: null as string | null })) as any;
const sessionUpdate = mock(() => Promise.resolve({})) as any;
const execConfigFindUnique = mock(() =>
  Promise.resolve(null as { maxRetries: number } | null),
) as any;
const executionFindFirst = mock(() =>
  Promise.resolve(null as { agentConfigId: number } | null),
) as any;

const mockPrisma = {
  agentSession: { findUnique: sessionFindUnique, update: sessionUpdate },
  agentExecutionConfig: { findUnique: execConfigFindUnique },
  agentExecution: { findFirst: executionFindFirst },
};

// NOTE: bun mock.module must mirror every export the module graph touches;
// verification-gate's import chain reads ensureDatabaseConnection too.
mock.module('../../../config/database', () => ({
  prisma: mockPrisma,
  ensureDatabaseConnection: () => Promise.resolve(),
}));
mock.module('../../../config/logger', () => {
  const noop = {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    fatal: () => {},
  };
  return {
    createLogger: () => noop,
    logger: noop,
    getBackendLogFilePath: () => '/tmp/backend.log',
  };
});

const blockTaskForVerification = mock(() => Promise.resolve()) as any;
mock.module('./verification-gate', () => ({ blockTaskForVerification }));

const executeTask = mock(() => Promise.resolve({})) as any;
mock.module('../agent-worker-manager', () => ({
  AgentWorkerManager: { getInstance: () => ({ executeTask }) },
}));

const { retryOrBlock } = await import('./verification-retry');
import type { VerificationResult } from './automated-verifier';

const RESULT: VerificationResult = {
  ok: false,
  unverifiable: false,
  changedFiles: ['a.ts'],
  checks: [{ name: 'lint', ran: true, ok: false, errorCount: 1, details: 'eslint: x' }],
  summary: '自動検証: lint=NG(1)',
};

beforeEach(() => {
  for (const m of [
    sessionFindUnique,
    sessionUpdate,
    execConfigFindUnique,
    executionFindFirst,
    blockTaskForVerification,
    executeTask,
  ]) {
    m.mockReset();
  }
  sessionFindUnique.mockResolvedValue({ metadata: null });
  sessionUpdate.mockResolvedValue({});
  execConfigFindUnique.mockResolvedValue(null);
  executionFindFirst.mockResolvedValue(null);
  blockTaskForVerification.mockResolvedValue(undefined);
  executeTask.mockResolvedValue({});
});

describe('retryOrBlock — fault injection', () => {
  test('unverifiable results block without relaunching the implementer', async () => {
    const result = { ...RESULT, unverifiable: true };
    const onReverify = mock(async () => {});
    const out = await retryOrBlock({
      taskId: 1,
      sessionId: 10,
      taskTitle: 't',
      executionDir: 'C:/wt',
      result,
      onReverify,
    });
    expect(out.retried).toBe(false);
    expect(blockTaskForVerification).toHaveBeenCalledWith(1, result, 10);
    expect(executeTask).not.toHaveBeenCalled();
    expect(sessionUpdate).not.toHaveBeenCalled();
    expect(onReverify).not.toHaveBeenCalled();
  });

  test('blocks (fails closed) instead of assuming attempt 1 when the session read fails', async () => {
    sessionFindUnique.mockRejectedValue(new Error('DB hiccup'));

    const out = await retryOrBlock({
      taskId: 1,
      sessionId: 10,
      taskTitle: 't',
      executionDir: 'C:/wt',
      result: RESULT,
      onReverify: async () => {},
    });

    expect(out.retried).toBe(false);
    expect(blockTaskForVerification).toHaveBeenCalledWith(1, RESULT, 10);
    // Must NOT have proceeded to persist a (wrongly reset) counter or relaunch.
    expect(sessionUpdate).not.toHaveBeenCalled();
    expect(executeTask).not.toHaveBeenCalled();
  });

  test('still retries normally when the session read succeeds', async () => {
    sessionFindUnique.mockResolvedValue({ metadata: '{"verificationRetries":0}' });

    const out = await retryOrBlock({
      taskId: 1,
      sessionId: 10,
      taskTitle: 't',
      executionDir: 'C:/wt',
      result: RESULT,
      onReverify: async () => {},
    });

    expect(out.retried).toBe(true);
    expect(blockTaskForVerification).not.toHaveBeenCalled();
    expect(sessionUpdate).toHaveBeenCalled();
  });

  test('blocks the task when the self-repair relaunch itself rejects', async () => {
    sessionFindUnique.mockResolvedValue({ metadata: '{"verificationRetries":0}' });
    executeTask.mockRejectedValue(new Error('spawn failed'));

    const out = await retryOrBlock({
      taskId: 1,
      sessionId: 10,
      taskTitle: 't',
      executionDir: 'C:/wt',
      result: RESULT,
      onReverify: async () => {},
    });

    // retryOrBlock itself reports retried:true synchronously (launch is
    // fire-and-forget) — the fault surfaces asynchronously via the catch.
    expect(out.retried).toBe(true);

    // Flush the microtask queue so the fire-and-forget .then/.catch chain runs.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(blockTaskForVerification).toHaveBeenCalledWith(1, RESULT, 10);
  });
});
