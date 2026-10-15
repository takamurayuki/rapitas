/**
 * respond-route.test
 *
 * Regression coverage for POST /tasks/:id/agent-respond. Verifies that:
 * (a) resuming a paused execution is fire-and-forget — the HTTP response
 *     returns as soon as the lock is acquired and task.status is updated,
 *     WITHOUT waiting for the (potentially long) next agent turn to finish —
 *     and (b) every rejection branch now returns a real non-200 status
 *     code instead of a silently-swallowed 200.
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test';

type FindUniqueResult = {
  task: { theme: { workingDirectory: string | null; name: string } | null };
  agentSessions: Array<{
    id: number;
    agentExecutions: Array<{ id: number; status: string }>;
  }>;
} | null;

let findUniqueResult: FindUniqueResult;
let taskUpdateMock = mock(() => Promise.resolve({}));

mock.module('../../../../config/database', () => ({
  prisma: {
    developerModeConfig: {
      findUnique: mock(() => Promise.resolve(findUniqueResult)),
    },
    task: {
      update: (...args: unknown[]) => taskUpdateMock(...args),
    },
  },
}));

mock.module('../../../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));

mock.module('../../../../config', () => ({
  getProjectRoot: () => 'C:\\Projects\\rapitas\\rapitas-backend',
}));

let tryAcquireResult = true;
const cancelQuestionTimeoutMock = mock(() => {});
// A controllable deferred so tests can assert the route returns BEFORE this
// resolves (proving the continuation call is fire-and-forget, not awaited).
let resolveContinuation: (value: { success: boolean; errorMessage?: string }) => void = () => {};
let continuationPromise: Promise<{ success: boolean; errorMessage?: string }>;
const executeContinuationWithLockMock = mock(() => continuationPromise);

mock.module('../../../../services/agents/agent-worker-manager', () => ({
  AgentWorkerManager: {
    getInstance: () => ({
      tryAcquireContinuationLockAsync: mock(() => Promise.resolve(tryAcquireResult)),
      cancelQuestionTimeout: cancelQuestionTimeoutMock,
      executeContinuationWithLock: executeContinuationWithLockMock,
    }),
  },
}));

const { respondRoute } = await import('./respond-route');

function makeConfig(
  overrides: Partial<{
    workingDirectory: string | null;
    executionStatus: string;
    hasSession: boolean;
    hasExecution: boolean;
  }> = {},
): FindUniqueResult {
  const {
    workingDirectory = '/fake/workdir',
    executionStatus = 'waiting_for_input',
    hasSession = true,
    hasExecution = true,
  } = overrides;
  return {
    task: { theme: { workingDirectory, name: 'test-theme' } },
    agentSessions: hasSession
      ? [{ id: 1, agentExecutions: hasExecution ? [{ id: 42, status: executionStatus }] : [] }]
      : [],
  };
}

async function callRoute(taskId: number, response = 'my answer') {
  const res = await respondRoute.handle(
    new Request(`http://localhost/tasks/${taskId}/agent-respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ response }),
    }),
  );
  const body = (await res.json()) as Record<string, unknown>;
  return { status: res.status, body };
}

describe('POST /tasks/:id/agent-respond', () => {
  beforeEach(() => {
    findUniqueResult = makeConfig();
    tryAcquireResult = true;
    taskUpdateMock.mockClear();
    cancelQuestionTimeoutMock.mockClear();
    executeContinuationWithLockMock.mockClear();
    continuationPromise = new Promise((resolve) => {
      resolveContinuation = resolve;
    });
  });

  it('rejects an empty response with 400', async () => {
    const { status, body } = await callRoute(1, '   ');
    expect(status).toBe(400);
    expect(body.error).toBeTruthy();
  });

  it('returns 404 when no active session exists', async () => {
    findUniqueResult = makeConfig({ hasSession: false });
    const { status } = await callRoute(1);
    expect(status).toBe(404);
  });

  it('returns 404 when the session has no execution', async () => {
    findUniqueResult = makeConfig({ hasExecution: false });
    const { status } = await callRoute(1);
    expect(status).toBe(404);
  });

  it('returns 409 when the execution is already running', async () => {
    findUniqueResult = makeConfig({ executionStatus: 'running' });
    const { status } = await callRoute(1);
    expect(status).toBe(409);
  });

  it('returns 409 when the execution is not waiting for input', async () => {
    findUniqueResult = makeConfig({ executionStatus: 'completed' });
    const { status } = await callRoute(1);
    expect(status).toBe(409);
  });

  it('returns 422 when the theme has no workingDirectory configured', async () => {
    findUniqueResult = makeConfig({ workingDirectory: null });
    const { status } = await callRoute(1);
    expect(status).toBe(422);
  });

  it('returns 409 when the continuation lock cannot be acquired', async () => {
    tryAcquireResult = false;
    const { status } = await callRoute(1);
    expect(status).toBe(409);
  });

  // Regression (task 504 / question-answer resume bug): the route used to
  // `await` the entire next agent turn before responding, so the client's
  // "resumed" UI update (and the frontend's grace-period/question-clearing
  // logic keyed to that response) was delayed by however long the turn took —
  // during which the execution log looked stuck on the old question.
  it('responds immediately without waiting for the continuation to finish (fire-and-forget)', async () => {
    let routeSettled = false;
    const routePromise = callRoute(1).then((r) => {
      routeSettled = true;
      return r;
    });

    // Give the route's own awaited work (lock acquisition, task.update) a
    // chance to run, but the continuation promise is still deliberately
    // unresolved at this point.
    await new Promise((r) => setTimeout(r, 20));
    expect(routeSettled).toBe(true);

    const { status, body } = await routePromise;
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(taskUpdateMock).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { status: 'in-progress' },
    });
    expect(executeContinuationWithLockMock).toHaveBeenCalled();

    // Cleanup: resolve the still-pending continuation so it doesn't leak
    // into the next test.
    resolveContinuation({ success: true });
  });

  it('does not throw or crash the process when the fire-and-forget continuation later fails', async () => {
    const { status } = await callRoute(1);
    expect(status).toBe(200);
    // Resolve with a business-logic failure after the response already went out.
    resolveContinuation({ success: false, errorMessage: 'boom' });
    // Let the .then() handler run; nothing should throw.
    await new Promise((r) => setTimeout(r, 10));
  });
});
