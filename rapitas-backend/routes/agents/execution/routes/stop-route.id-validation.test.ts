// @ts-nocheck — Loosely-typed mock setup; types are not the concern of this test file.
/**
 * stop-route.id-validation.test
 *
 * Proves POST /tasks/:id/stop-execution refuses an id that names no row,
 * instead of truncating it and stopping whichever row the prefix happens to
 * name. Reproduced on the running server before the fix (#1349):
 *
 *   POST /tasks/1475abc/stop-execution
 *     -> 200 {"success":true,"stoppedCount":0,...}
 *     -> row 1475: status in_progress -> 'todo', executionGenerationId 0 -> 1
 *
 * The assertions are on the DATABASE, not on the status code. A status is what
 * #1346 pinned a defect with, and the generation bump is the write that
 * matters most here: stale-recovery-helpers.ts reads it before reviving a
 * session, so bumping it on an unrelated task is what kills a live agent.
 *
 * Lives beside stop-route.test.ts rather than inside it because that file is
 * already 627 lines (COMPONENT_SPLITTING_POLICY §2: split before adding).
 */

import { describe, it, expect, beforeEach, mock } from 'bun:test';

const mockDb = {
  task: {
    findUnique: mock(() => Promise.resolve(null)),
    update: mock(() => Promise.resolve({})),
  },
  agentExecution: {
    findFirst: mock(() => Promise.resolve(null)),
    findUnique: mock(() => Promise.resolve(null)),
    update: mock(() => Promise.resolve({})),
  },
  agentSession: {
    findMany: mock(() => Promise.resolve([])),
    update: mock(() => Promise.resolve({})),
    updateMany: mock(() => Promise.resolve({ count: 0 })),
  },
  workflowQueueItem: {
    updateMany: mock(() => Promise.resolve({ count: 0 })),
  },
};

const mockStopTaskAgents = mock(() => Promise.resolve({ stoppedCount: 0 }));
const mockResolveTaskWorkingDirectory = mock(() => Promise.resolve(null));
const mockRecordTransition = mock(() => Promise.resolve());
const mockReleaseTaskExecLock = mock(() => undefined);
const mockRemoveWorktree = mock(() => Promise.resolve(true));
const mockRevertChanges = mock(() => Promise.resolve());

mock.module('../../../../config/database', () => ({
  ensureDatabaseConnection: () => Promise.resolve(),
  prisma: mockDb,
}));

mock.module('../../../../config', () => ({
  prisma: mockDb,
  getProjectRoot: () => '/tmp/rapitas-test',
  createLogger: () => ({ info: () => {}, error: () => {}, warn: () => {}, debug: () => {} }),
}));

mock.module('../../../../services/agents/agent-worker-manager', () => ({
  AgentWorkerManager: {
    getInstance: mock(() => ({
      getSessionExecutionsAsync: mock(() => Promise.resolve([])),
      stopExecution: mock(),
      revertChanges: mockRevertChanges,
    })),
  },
}));

// NOTE: every export is mirrored — bun's mock.module replaces the whole module,
// so a missing export makes this file stop with one error and its tests vanish.
mock.module(
  '../../../../services/agents/orchestrator/git-operations/worktree/worktree-ops',
  () => ({
    removeWorktree: mockRemoveWorktree,
    cleanupStaleWorktrees: mock(() => Promise.resolve(0)),
    cleanupOrphanedWorktrees: mock(() => Promise.resolve(0)),
    createWorktree: mock(() => Promise.resolve('')),
    ensureGitRepository: mock(() => Promise.resolve()),
    validateAndSetupRemote: mock(() => Promise.resolve()),
  }),
);

mock.module('../../../../services/agents/stop-task-agents', () => ({
  stopTaskAgents: mockStopTaskAgents,
  stopThemeAgents: mock(() => Promise.resolve()),
}));

mock.module('../../../../services/task/task-resolver', () => ({
  resolveTaskWorkingDirectory: mockResolveTaskWorkingDirectory,
}));

mock.module('../../../../services/workflow/auto-run/theme-auto-run-service', () => ({
  getAutoRunState: mock(() => Promise.resolve(null)),
  finalizeStop: mock(() => Promise.resolve()),
  isAutoRunHandlingTask: mock(() => false),
}));

mock.module('../../../../services/workflow/transition-recorder', () => ({
  recordTransition: mockRecordTransition,
}));

mock.module('../shared/execution-lock', () => ({
  releaseTaskExecutionLock: mockReleaseTaskExecLock,
}));

const { stopRoute } = await import('./stop-route');

const BASE = 'http://localhost/tasks';

/** Clears every mock and restores the "row 1475 is real and in progress" world. */
function resetMocks() {
  mockDb.task.findUnique.mockReset();
  // A row the prefix NAMES, so a handler that truncates reaches something real.
  // Left at its default null, every case would stop at a 404 and the test would
  // pass without the dangerous path ever being walked (the mistake made once in
  // #1349's first PR).
  mockDb.task.findUnique.mockResolvedValue({ workflowStatus: 'in_progress' });
  mockDb.task.update.mockReset();
  mockDb.task.update.mockResolvedValue({});
  mockDb.agentSession.findMany.mockReset();
  mockDb.agentSession.findMany.mockResolvedValue([]);
  mockDb.agentSession.updateMany.mockClear();
  mockDb.workflowQueueItem.updateMany.mockClear();
  mockStopTaskAgents.mockReset();
  mockStopTaskAgents.mockResolvedValue({ stoppedCount: 1 });
  mockResolveTaskWorkingDirectory.mockReset();
  mockResolveTaskWorkingDirectory.mockResolvedValue({ workingDirectory: null, themeId: null });
  mockRecordTransition.mockClear();
  mockReleaseTaskExecLock.mockClear();
  mockRevertChanges.mockClear();
}

// Each of these resolves to a DIFFERENT row than the caller typed, or to no row
// at all. '1475abc' is the shape reproduced on the running server.
const TRUNCATING_IDS: [string, string][] = [
  ['a trailing suffix', '1475abc'],
  ['exponent notation', '5e2'],
  ['a decimal', '5.9'],
  ['hex notation', '0x10'],
  ['a negative number', '-3'],
  ['zero', '0'],
  ['a number past MAX_SAFE_INTEGER', '99999999999999999999'],
  ['leading whitespace', '%201475'],
];

describe('POST /tasks/:id/stop-execution — an id that names no row', () => {
  beforeEach(resetMocks);

  it.each(TRUNCATING_IDS)('refuses %s (%s) without touching the database', async (_label, raw) => {
    const res = await stopRoute.handle(
      new Request(`${BASE}/${raw}/stop-execution`, { method: 'POST' }),
    );

    // Not a success: the caller must not be told a stop happened.
    expect(res.status).toBeGreaterThanOrEqual(400);

    // Nothing was stopped, nothing was reset, no generation was bumped, no
    // transition was recorded — the row the prefix names is untouched.
    expect(mockStopTaskAgents).not.toHaveBeenCalled();
    expect(mockDb.task.update).not.toHaveBeenCalled();
    expect(mockRecordTransition).not.toHaveBeenCalled();
    expect(mockDb.workflowQueueItem.updateMany).not.toHaveBeenCalled();
    expect(mockDb.agentSession.updateMany).not.toHaveBeenCalled();
    expect(mockRevertChanges).not.toHaveBeenCalled();
  });
});

describe('POST /tasks/:id/stop-execution — a valid id still stops', () => {
  beforeEach(resetMocks);

  // Over-correction guard: rejecting everything would also satisfy the block
  // above, so this fails if the new check is too strict.
  it('stops the task the id names and resets its status', async () => {
    const res = await stopRoute.handle(
      new Request(`${BASE}/1475/stop-execution`, { method: 'POST' }),
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.stoppedCount).toBe(1);
    expect(mockStopTaskAgents).toHaveBeenCalledWith(1475, { errorMessage: 'Cancelled by user' });
    expect(mockDb.task.update).toHaveBeenCalledWith({
      where: { id: 1475 },
      data: { status: 'todo' },
    });
  });
});
