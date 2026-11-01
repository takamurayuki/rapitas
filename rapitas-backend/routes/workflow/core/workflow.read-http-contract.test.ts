// @ts-nocheck — Loosely-typed mock setup; types are not the concern of this test file.
/**
 * workflow.read-http-contract.test
 *
 * The two read-only workflow endpoints answered HTTP 200 for every outcome,
 * including a refused id and a failed query, with the real outcome only in the
 * body. A caller reading the status was told the request had worked.
 *
 * This is the same shape #1335 fixed on stop-execution: "a status code that
 * contradicts its own body is not a contract any other caller should have to
 * know about". The contract held down here:
 *
 *   invalid id      -> 400, and the database is never reached
 *   query failed    -> 500
 *   fine, no rows   -> 200 with an empty history (empty is not 404)
 *
 * The response BODIES are unchanged — `{ success, error }` and
 * `{ success, taskId, count, transitions }` are what the frontend already
 * reads; only the status joins them.
 */

import { describe, it, expect, beforeEach, mock } from 'bun:test';

const mockDb = {
  workflowTransition: { findMany: mock(() => Promise.resolve([])) },
  activityLog: { findMany: mock(() => Promise.resolve([])) },
};

mock.module('../../../config', () => ({
  prisma: mockDb,
  getProjectRoot: () => '/tmp/rapitas-test',
  createLogger: () => ({ info: () => {}, error: () => {}, warn: () => {}, debug: () => {} }),
}));

mock.module('../../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, error: () => {}, warn: () => {}, debug: () => {} }),
}));

/** Every handler the router wires up, stubbed — none of them is under test here. */
const stub = () => mock(() => Promise.resolve({ success: true }));
mock.module('../handlers/workflow-handlers', () => ({
  handleGetFiles: stub(),
  handleGetFile: stub(),
  handleSaveFile: stub(),
  handleApprovePlan: stub(),
  handleUpdateStatus: stub(),
  handleAdvanceWorkflow: stub(),
  handleSetMode: stub(),
  handleSetWorkflowDisabled: stub(),
  handleAnalyzeComplexity: stub(),
  handleGetModes: stub(),
  handleResumeFromQuestion: stub(),
  handleAnswerWorkflowQuestion: stub(),
  handleRunVerification: stub(),
  handleRunVerificationStatus: stub(),
  handleRunVerificationLatest: stub(),
}));
mock.module('../handlers/workflow-handlers-plan-revision', () => ({
  handleRevisePlan: stub(),
}));
mock.module('../handlers/workflow-handlers-dry-run', () => ({
  handleDryRun: stub(),
  handleDryRunHistory: stub(),
  handleDryRunDrift: stub(),
}));

const mockComputeMetrics = mock(() => ({ iterations: [], totals: {} }));
mock.module('../../../services/workflow/repair-iteration-metrics', () => ({
  computeRepairIterationMetrics: mockComputeMetrics,
}));

const { workflowRoutes } = await import('./workflow');

const BASE = 'http://localhost/workflow/tasks';

function resetMocks() {
  mockDb.workflowTransition.findMany.mockReset();
  mockDb.workflowTransition.findMany.mockResolvedValue([]);
  mockDb.activityLog.findMany.mockReset();
  mockDb.activityLog.findMany.mockResolvedValue([]);
  mockComputeMetrics.mockClear();
}

// '5e2' is 500 and '0x5' is 5 under the old parseInt; the guard already refuses
// them, but refusing under HTTP 200 is what this file is about.
const BAD_IDS = ['5abc', '5e2', '0x5', '5.9', '0', '-3', 'not-a-number'];

describe('GET /tasks/:taskId/transitions', () => {
  beforeEach(resetMocks);

  it.each(BAD_IDS)('answers 400 for %s, without reaching the database', async (raw) => {
    const res = await workflowRoutes.handle(new Request(`${BASE}/${raw}/transitions`));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ success: false, error: 'invalid taskId' });
    expect(mockDb.workflowTransition.findMany).not.toHaveBeenCalled();
  });

  it('answers 500 when the query fails', async () => {
    mockDb.workflowTransition.findMany.mockRejectedValue(new Error('DB down'));

    const res = await workflowRoutes.handle(new Request(`${BASE}/5/transitions`));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ success: false, error: 'failed to load transitions' });
  });

  it('answers 200 with an empty history when there is nothing recorded', async () => {
    // Empty is not missing: a task with no transitions yet is a normal state,
    // and a 404 here would read to the frontend as "this task is gone".
    const res = await workflowRoutes.handle(new Request(`${BASE}/5/transitions`));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, taskId: 5, count: 0, transitions: [] });
  });
});

describe('GET /tasks/:taskId/repair-iterations', () => {
  beforeEach(resetMocks);

  it.each(BAD_IDS)('answers 400 for %s, without reaching the database', async (raw) => {
    const res = await workflowRoutes.handle(new Request(`${BASE}/${raw}/repair-iterations`));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ success: false, error: 'invalid taskId' });
    expect(mockDb.workflowTransition.findMany).not.toHaveBeenCalled();
    expect(mockDb.activityLog.findMany).not.toHaveBeenCalled();
  });

  it('answers 500 when either query fails', async () => {
    mockDb.activityLog.findMany.mockRejectedValue(new Error('DB down'));

    const res = await workflowRoutes.handle(new Request(`${BASE}/5/repair-iterations`));

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      success: false,
      error: 'failed to load repair iteration data',
    });
  });

  it('answers 200 when there are no repair iterations', async () => {
    const res = await workflowRoutes.handle(new Request(`${BASE}/5/repair-iterations`));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(mockComputeMetrics).toHaveBeenCalled();
  });
});
