// @ts-nocheck — Loosely-typed mock setup; types are not the concern of this test file.
/**
 * workflow-handlers-dry-run.id-validation.test
 *
 * Proves the three dry-run handlers refuse an id that names no task, and refuse
 * it before the database or the verification orchestrator is reached.
 *
 * These were missed by #1349's first six passes for a different reason than the
 * API key route: the handlers live in their own module and are wired up from
 * workflow.ts, so no `.post`/`.get` call is an ancestor of the coercion. The
 * rule's first version left an unknown verb alone, which let every extracted
 * handler through. It now reports them.
 *
 * Calling the handlers directly rather than through the router is deliberate:
 * they take `{ params, set }` and nothing else, so the test can see exactly
 * what the handler did and did not do, including the status it set.
 */

import { describe, it, expect, beforeEach, mock } from 'bun:test';

const mockDb = {
  agentSession: { findFirst: mock(() => Promise.resolve(null)) },
  task: { findUnique: mock(() => Promise.resolve(null)) },
  timelineEvent: {
    findMany: mock(() => Promise.resolve([])),
    findFirst: mock(() => Promise.resolve(null)),
    create: mock(() => Promise.resolve({ id: 1 })),
  },
};

const mockRunDryRunVerification = mock(() => Promise.resolve({ ok: true }));
const mockResolveAcceptance = mock(() => Promise.resolve([]));
const mockReadWorkflowFile = mock(() => Promise.resolve(null));
const mockResolveBaseBranch = mock(() => Promise.resolve('develop'));
const mockExecGitReadonly = mock(() => Promise.resolve({ stdout: '', stderr: '' }));

mock.module('../../../config', () => ({ prisma: mockDb }));
mock.module('../../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, error: () => {}, warn: () => {}, debug: () => {} }),
}));
mock.module('../../../services/agents/verification/acceptance-self-check', () => ({
  resolveAcceptanceCriteria: mockResolveAcceptance,
}));
mock.module('../../../services/workflow/workflow-file-utils', () => ({
  readWorkflowFile: mockReadWorkflowFile,
}));
mock.module('../../../services/task/task-resolver', () => ({
  resolvePreferredBaseBranch: mockResolveBaseBranch,
  resolveTaskWorkingDirectory: mock(() => Promise.resolve(null)),
  resolveTaskForExecution: mock(() => Promise.resolve(null)),
}));
mock.module('../../../services/workflow/dry-run-orchestrator', () => ({
  runDryRunVerification: mockRunDryRunVerification,
}));
mock.module('../../../services/agents/orchestrator/git-operations/core/git-exec', () => ({
  execGitReadonly: mockExecGitReadonly,
  execGit: mock(() => Promise.resolve({ stdout: '', stderr: '' })),
}));

const { handleDryRun, handleDryRunHistory, handleDryRunDrift } =
  await import('./workflow-handlers-dry-run');

function resetMocks() {
  mockDb.agentSession.findFirst.mockReset();
  // A worktree the prefix would reach. Left at null, every case would stop at
  // the 404 below and the test would pass without the coercion mattering.
  mockDb.agentSession.findFirst.mockResolvedValue({ worktreePath: '/tmp/wt-5' });
  mockDb.task.findUnique.mockClear();
  mockDb.timelineEvent.findMany.mockClear();
  mockDb.timelineEvent.findFirst.mockClear();
  mockDb.timelineEvent.create.mockClear();
  mockRunDryRunVerification.mockClear();
  mockResolveAcceptance.mockClear();
  mockReadWorkflowFile.mockClear();
}

const TRUNCATING_IDS: [string, string][] = [
  ['a trailing suffix', '5abc'],
  ['exponent notation', '5e2'],
  ['hex notation', '0x5'],
  ['a decimal', '5.9'],
  ['zero', '0'],
  ['a negative number', '-3'],
];

describe('handleDryRun — an id that names no task', () => {
  beforeEach(resetMocks);

  it.each(TRUNCATING_IDS)('refuses %s (%s) before running anything', async (_label, raw) => {
    const ctx = { params: { taskId: raw }, set: {} };

    const result = await handleDryRun(ctx);

    expect(ctx.set.status).toBe(400);
    expect(result).toEqual({ success: false, error: 'invalid taskId' });
    // No worktree lookup, and above all no verification run: a dry run against
    // another task's worktree executes its gates and writes timeline rows.
    expect(mockDb.agentSession.findFirst).not.toHaveBeenCalled();
    expect(mockRunDryRunVerification).not.toHaveBeenCalled();
    expect(mockDb.timelineEvent.create).not.toHaveBeenCalled();
  });
});

describe('handleDryRunHistory — an id that names no task', () => {
  beforeEach(resetMocks);

  it.each(TRUNCATING_IDS)('refuses %s (%s) before reading the timeline', async (_label, raw) => {
    const ctx = { params: { taskId: raw }, set: {} };

    const result = await handleDryRunHistory(ctx);

    expect(ctx.set.status).toBe(400);
    expect(result).toEqual({ success: false, error: 'invalid taskId' });
    expect(mockDb.timelineEvent.findMany).not.toHaveBeenCalled();
  });
});

describe('handleDryRunDrift — either id naming no row', () => {
  beforeEach(resetMocks);

  it.each([
    ['a bad taskId', '5abc', '1'],
    ['a bad reportId', '5', '1e1'],
    ['both bad', '5e2', '0x1'],
  ])('refuses %s (%s / %s) before reading the report', async (_label, taskId, reportId) => {
    const ctx = { params: { taskId, reportId }, set: {} };

    const result = await handleDryRunDrift(ctx);

    expect(ctx.set.status).toBe(400);
    expect(result).toEqual({ success: false, error: 'invalid taskId or reportId' });
    expect(mockDb.timelineEvent.findFirst).not.toHaveBeenCalled();
  });
});

describe('a valid id still reaches the worktree lookup', () => {
  beforeEach(resetMocks);

  // Over-correction guard: refusing everything would satisfy the blocks above.
  // The run is not followed further than the lookup — this file is about the
  // id, and the orchestrator has its own tests.
  it('looks up the worktree of the task the id names', async () => {
    const ctx = { params: { taskId: '5' }, set: {} };

    await handleDryRun(ctx);

    expect(mockDb.agentSession.findFirst).toHaveBeenCalled();
    const where = mockDb.agentSession.findFirst.mock.calls[0]?.[0]?.where;
    expect(where?.config?.taskId).toBe(5);
  });
});
