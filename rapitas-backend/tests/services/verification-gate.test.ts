/**
 * Shared automated verification gate tests.
 */
import { beforeEach, describe, expect, mock, test } from 'bun:test';

const mockPrisma = {
  task: {
    update: mock(() => Promise.resolve({})),
  },
  agentSession: {
    update: mock(() => Promise.resolve({})),
  },
};

let verifierMode: 'pass' | 'fail' | 'throw' = 'pass';

mock.module('../../config/database', () => ({
  ensureDatabaseConnection: () => Promise.resolve(),
  prisma: mockPrisma,
}));
mock.module('../../config/logger', () => {
  const stub = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
  // Provide BOTH the factory and the `logger` singleton — a transitively
  // imported module uses `import { logger }`, which errors if the mock omits it.
  return { createLogger: () => stub, logger: stub };
});
const createNotification = mock(() => Promise.resolve({})) as any;
// NOTE: mock.module replaces the module for the WHOLE bun test process (other
// test files run in the same invocation may import the real module too), so
// every value export is stubbed here rather than just `createNotification` —
// otherwise an unrelated file destructuring e.g. `notifyTaskCompleted` from
// this same physical module would fail with "export not found".
mock.module('../../services/communication/notification-service', () => ({
  createNotification,
  notifyTaskCompleted: () => Promise.resolve(),
  notifyAgentExecutionCompleted: () => Promise.resolve(),
  notifyApprovalRequested: () => Promise.resolve(),
  notifyAuthenticationFailure: () => Promise.resolve(),
  notifyPomodoroCompleted: () => Promise.resolve(),
  AUTH_FAILURE_NOTIFICATION_TITLE: 'Claude 認証切れ',
}));

mock.module('../../services/agents/verification/automated-verifier', () => ({
  runAutomatedVerification: mock(async (_worktreePath: string) => {
    if (verifierMode === 'throw') throw new Error('tool crashed');
    if (verifierMode === 'fail') {
      return {
        ok: false,
        changedFiles: ['src/broken.ts'],
        checks: [
          {
            name: 'typecheck',
            ran: true,
            ok: false,
            errorCount: 1,
            details: 'TS2322: Type string is not assignable to number',
          },
        ],
        summary: '1 new typecheck error in src/broken.ts',
      };
    }
    return {
      ok: true,
      changedFiles: ['src/ok.ts'],
      checks: [{ name: 'lint', ran: true, ok: true, errorCount: 0, details: '' }],
      summary: 'verification passed',
    };
  }),
  renderVerificationMarkdown: (result: { summary: string }) =>
    `# Verification\n\n${result.summary}`,
}));

const { runVerificationGate } =
  await import('../../services/agents/verification/verification-gate');

function resetMockFunctions(value: unknown): void {
  if (typeof value === 'function' && 'mockReset' in value) {
    (value as ReturnType<typeof mock>).mockReset();
    return;
  }
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) resetMockFunctions(child);
  }
}

describe('runVerificationGate', () => {
  beforeEach(() => {
    resetMockFunctions(mockPrisma);
    mockPrisma.task.update.mockResolvedValue({});
    mockPrisma.agentSession.update.mockResolvedValue({});
    createNotification.mockReset();
    createNotification.mockResolvedValue({});
    verifierMode = 'pass';
  });

  test('opens the gate when automated verification passes', async () => {
    const outcome = await runVerificationGate(1, 'C:\\repo\\app\\.worktrees\\task-1', 10);

    expect(outcome.ok).toBe(true);
    expect(outcome.result?.summary).toBe('verification passed');
    expect(mockPrisma.task.update).not.toHaveBeenCalled();
    expect(mockPrisma.agentSession.update).not.toHaveBeenCalled();
  });

  test('blocks the task and fails the session when verification finds new failures', async () => {
    verifierMode = 'fail';

    const outcome = await runVerificationGate(1, 'C:\\repo\\app\\.worktrees\\task-1', 10);

    expect(outcome.ok).toBe(false);
    expect(outcome.result?.summary).toContain('typecheck error');
    expect(mockPrisma.task.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: expect.objectContaining({ status: 'blocked' }),
    });
    expect(mockPrisma.agentSession.update).toHaveBeenCalledWith({
      where: { id: 10 },
      data: expect.objectContaining({
        status: 'failed',
        errorMessage: expect.stringContaining('1 new typecheck error'),
      }),
    });
  });

  test('opens the gate if the verifier itself crashes', async () => {
    verifierMode = 'throw';

    const outcome = await runVerificationGate(1, 'C:\\repo\\app\\.worktrees\\task-1', 10);

    expect(outcome).toEqual({ ok: true, result: null });
    expect(mockPrisma.task.update).not.toHaveBeenCalled();
    expect(mockPrisma.agentSession.update).not.toHaveBeenCalled();
  });

  describe('blockTaskForVerification — durable write fault injection', () => {
    test('retries the blocked-status write once on failure, then succeeds', async () => {
      verifierMode = 'fail';
      mockPrisma.task.update
        .mockImplementationOnce(() => Promise.reject(new Error('transient DB error')))
        .mockImplementationOnce(() => Promise.resolve({}));

      const outcome = await runVerificationGate(1, 'C:\\repo\\app\\.worktrees\\task-1', 10);

      expect(outcome.ok).toBe(false);
      expect(mockPrisma.task.update).toHaveBeenCalledTimes(2);
      // Write eventually landed — no need to escalate via notification.
      expect(createNotification).not.toHaveBeenCalled();
    });

    test('notifies when the blocked-status write fails on every attempt', async () => {
      verifierMode = 'fail';
      mockPrisma.task.update.mockImplementation(() => Promise.reject(new Error('DB down')));

      const outcome = await runVerificationGate(1, 'C:\\repo\\app\\.worktrees\\task-1', 10);

      expect(outcome.ok).toBe(false);
      expect(mockPrisma.task.update).toHaveBeenCalledTimes(2);
      // FAIL-CLOSED ESCALATION: the loop-stopping write never landed — a human
      // must be notified instead of the task silently staying un-blocked.
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(createNotification).toHaveBeenCalledTimes(1);
      expect(createNotification.mock.calls[0][0]).toEqual(
        expect.objectContaining({ metadata: expect.objectContaining({ taskId: 1 }) }),
      );
    });

    test('retries the session-failed write once on failure, then succeeds', async () => {
      verifierMode = 'fail';
      mockPrisma.agentSession.update
        .mockImplementationOnce(() => Promise.reject(new Error('transient DB error')))
        .mockImplementationOnce(() => Promise.resolve({}));

      const outcome = await runVerificationGate(1, 'C:\\repo\\app\\.worktrees\\task-1', 10);

      expect(outcome.ok).toBe(false);
      expect(mockPrisma.agentSession.update).toHaveBeenCalledTimes(2);
    });

    test('does not throw when the session-failed write fails on every attempt', async () => {
      verifierMode = 'fail';
      mockPrisma.agentSession.update.mockImplementation(() => Promise.reject(new Error('DB down')));

      // Must resolve (not reject) even though the session write never lands —
      // the gate's own contract is "never throws", only the task/session rows
      // stay unconfirmed and are logged loudly.
      const outcome = await runVerificationGate(1, 'C:\\repo\\app\\.worktrees\\task-1', 10);

      expect(outcome.ok).toBe(false);
      expect(mockPrisma.agentSession.update).toHaveBeenCalledTimes(2);
    });
  });
});
