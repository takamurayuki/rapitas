/**
 * workflow-handlers-dry-run.test
 *
 * Unit tests for the user-facing dry-run endpoints: invalid id, missing
 * worktree, happy path (dry-run/history/drift), and the per-task in-flight
 * guard. All collaborators are mocked.
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test';

const findFirstMock = mock(async (): Promise<unknown> => null);
const taskFindUniqueMock = mock(async (): Promise<unknown> => null);
const timelineEventFindManyMock = mock(async (): Promise<unknown[]> => []);
const timelineEventFindUniqueMock = mock(async (): Promise<unknown> => null);

mock.module('../../../config', () => ({
  prisma: {
    agentSession: { findFirst: findFirstMock },
    task: { findUnique: taskFindUniqueMock },
    timelineEvent: { findMany: timelineEventFindManyMock, findUnique: timelineEventFindUniqueMock },
  },
}));

mock.module('../../../config/logger', () => ({
  createLogger: () => ({ info: mock(() => {}), warn: mock(() => {}), debug: mock(() => {}) }),
}));

const readWorkflowFileMock = mock(async (): Promise<string | null> => null);
mock.module('../../../services/workflow/workflow-file-utils', () => ({
  readWorkflowFile: readWorkflowFileMock,
}));

const resolvePreferredBaseBranchMock = mock(async (): Promise<string | null> => 'develop');
mock.module('../../../services/task/task-resolver', () => ({
  resolvePreferredBaseBranch: resolvePreferredBaseBranchMock,
}));

const runDryRunVerificationMock = mock(async () => ({
  ok: true,
  gate: { ok: true, summary: 'ok', checks: [] },
  completionGate: { allow: true, reason: 'has_code_changes' },
  jury: { verdict: 'pass', severity: 0, reasons: [], judged: true },
  baseBranchSha: 'abc123',
  preferredBaseBranch: 'develop',
  skippedOperations: ['commit', 'push'],
  reportId: 42,
}));
mock.module('../../../services/workflow/dry-run-orchestrator', () => ({
  runDryRunVerification: runDryRunVerificationMock,
}));

const execGitReadonlyMock = mock(
  async (): Promise<{ stdout: string; stderr: string }> => ({
    stdout: 'abc123\n',
    stderr: '',
  }),
);
mock.module('../../../services/agents/orchestrator/git-operations/core/git-exec', () => ({
  execGitReadonly: execGitReadonlyMock,
}));

const { handleDryRun, handleDryRunHistory, handleDryRunDrift } =
  await import('./workflow-handlers-dry-run');

function ctx(taskId: string) {
  return { params: { taskId }, set: {} as { status?: number | string } };
}

function reportCtx(taskId: string, reportId: string) {
  return { params: { taskId, reportId }, set: {} as { status?: number | string } };
}

beforeEach(() => {
  findFirstMock.mockClear();
  taskFindUniqueMock.mockClear();
  timelineEventFindManyMock.mockClear();
  timelineEventFindUniqueMock.mockClear();
  readWorkflowFileMock.mockClear();
  resolvePreferredBaseBranchMock.mockClear();
  runDryRunVerificationMock.mockClear();
  execGitReadonlyMock.mockClear();

  findFirstMock.mockImplementation(async () => ({ worktreePath: 'C:/wt/task-1' }));
  taskFindUniqueMock.mockImplementation(async () => ({
    title: 'Add a widget',
    description: 'desc',
    acceptanceCriteria: null,
  }));
  runDryRunVerificationMock.mockImplementation(async () => ({
    ok: true,
    gate: { ok: true, summary: 'ok', checks: [] },
    completionGate: { allow: true, reason: 'has_code_changes' },
    jury: { verdict: 'pass', severity: 0, reasons: [], judged: true },
    baseBranchSha: 'abc123',
    preferredBaseBranch: 'develop',
    skippedOperations: ['commit', 'push'],
    reportId: 42,
  }));
  execGitReadonlyMock.mockImplementation(async () => ({ stdout: 'abc123\n', stderr: '' }));
});

describe('handleDryRun', () => {
  it('rejects a non-numeric task id with 400', async () => {
    const c = ctx('abc');
    const res = await handleDryRun(c);
    expect(c.set.status).toBe(400);
    expect(res).toMatchObject({ success: false });
  });

  it('returns 404 when the task has no worktree session', async () => {
    findFirstMock.mockImplementation(async () => null);
    const c = ctx('7');
    const res = await handleDryRun(c);
    expect(c.set.status).toBe(404);
    expect(res).toMatchObject({ success: false });
  });

  it('runs the dry-run orchestrator and returns the report with reportId', async () => {
    const res = await handleDryRun(ctx('7'));
    expect(res).toMatchObject({ success: true, ok: true, reportId: 42 });
    expect(runDryRunVerificationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: 7,
        worktreePath: 'C:/wt/task-1',
        preferredBaseBranch: 'develop',
      }),
    );
  });

  it('rejects a concurrent dry run for the same task with 429', async () => {
    let release: (() => void) | undefined;
    runDryRunVerificationMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () =>
            resolve({
              ok: true,
              gate: { ok: true, summary: 'ok', checks: [] },
              completionGate: { allow: true, reason: 'has_code_changes' },
              jury: { verdict: 'pass', severity: 0, reasons: [], judged: true },
              baseBranchSha: 'abc123',
              preferredBaseBranch: 'develop',
              skippedOperations: ['commit', 'push'],
              reportId: 42,
            });
        }),
    );
    const first = handleDryRun(ctx('9'));
    await new Promise((r) => setTimeout(r, 10));
    const c2 = ctx('9');
    const res2 = await handleDryRun(c2);
    expect(c2.set.status).toBe(429);
    expect(res2).toMatchObject({ success: false });
    release?.();
    const res1 = await first;
    expect(res1).toMatchObject({ success: true, ok: true });
  });

  it('returns 500 and releases the in-flight slot when the orchestrator throws', async () => {
    runDryRunVerificationMock.mockImplementation(async () => {
      throw new Error('boom');
    });
    const c = ctx('7');
    const res = await handleDryRun(c);
    expect(c.set.status).toBe(500);
    expect(res).toMatchObject({ success: false });
    runDryRunVerificationMock.mockImplementation(async () => ({
      ok: true,
      gate: { ok: true, summary: 'ok', checks: [] },
      completionGate: { allow: true, reason: 'has_code_changes' },
      jury: { verdict: 'pass', severity: 0, reasons: [], judged: true },
      baseBranchSha: 'abc123',
      preferredBaseBranch: 'develop',
      skippedOperations: ['commit', 'push'],
      reportId: 43,
    }));
    const res2 = await handleDryRun(ctx('7'));
    expect(res2).toMatchObject({ success: true, ok: true });
  });
});

describe('handleDryRunHistory', () => {
  it('rejects a non-numeric task id with 400', async () => {
    const c = ctx('abc');
    const res = await handleDryRunHistory(c);
    expect(c.set.status).toBe(400);
    expect(res).toMatchObject({ success: false });
  });

  it('returns recent dry-run reports for the task', async () => {
    timelineEventFindManyMock.mockImplementation(async () => [
      { id: 42, createdAt: new Date('2026-08-29T00:00:00Z'), payload: '{"ok":true}' },
    ]);
    const res = await handleDryRunHistory(ctx('7'));
    expect(res).toMatchObject({ success: true });
    expect((res as { reports: unknown[] }).reports).toHaveLength(1);
    expect(timelineEventFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { eventType: 'dry_run_executed', correlationId: 'task-7' },
      }),
    );
  });
});

describe('handleDryRunDrift', () => {
  it('rejects non-numeric ids with 400', async () => {
    const c = reportCtx('abc', '1');
    const res = await handleDryRunDrift(c);
    expect(c.set.status).toBe(400);
    expect(res).toMatchObject({ success: false });
  });

  it('reports driftDetected:false with a note when the report does not exist', async () => {
    timelineEventFindUniqueMock.mockImplementation(async () => null);
    const res = await handleDryRunDrift(reportCtx('7', '999'));
    expect(res).toMatchObject({ success: true, driftDetected: false });
    expect((res as { note?: string }).note).toBeTruthy();
  });

  it('reports driftDetected:false when the same SHA is still current', async () => {
    timelineEventFindUniqueMock.mockImplementation(async () => ({
      id: 42,
      eventType: 'dry_run_executed',
      correlationId: 'task-7',
      payload: JSON.stringify({ baseBranchSha: 'abc123', preferredBaseBranch: 'develop' }),
    }));
    execGitReadonlyMock.mockImplementation(async () => ({ stdout: 'abc123\n', stderr: '' }));
    const res = await handleDryRunDrift(reportCtx('7', '42'));
    expect(res).toMatchObject({
      success: true,
      driftDetected: false,
      storedSha: 'abc123',
      currentSha: 'abc123',
    });
  });

  it('reports driftDetected:true when the base branch has moved', async () => {
    timelineEventFindUniqueMock.mockImplementation(async () => ({
      id: 42,
      eventType: 'dry_run_executed',
      correlationId: 'task-7',
      payload: JSON.stringify({ baseBranchSha: 'abc123', preferredBaseBranch: 'develop' }),
    }));
    execGitReadonlyMock.mockImplementation(async (cmd: string) => {
      if (cmd.startsWith('git rev-list')) return { stdout: '3\n', stderr: '' };
      return { stdout: 'def456\n', stderr: '' };
    });
    const res = await handleDryRunDrift(reportCtx('7', '42'));
    expect(res).toMatchObject({
      success: true,
      driftDetected: true,
      storedSha: 'abc123',
      currentSha: 'def456',
      commitsBehind: 3,
    });
  });
});
