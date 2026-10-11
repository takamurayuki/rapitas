/**
 * supervisor-incident-inspect.cwd-mismatch.test
 *
 * The cwd-mismatch signature must be filed once per (task, cwd, theme dir),
 * not on every 5-minute watch tick (#1180: #1168/#1170 re-filed ~600 times).
 */
import { beforeEach, describe, expect, mock, test } from 'bun:test';

const NOW = Date.parse('2026-10-11T00:00:00.000Z');
let evidence = {
  themeWorkingDirectory: 'C:\\Projects\\rapitas' as string | null,
  taskWorkingDirectory: null as string | null,
  executionCwd: 'C:\\Projects\\temporaid\\.worktrees\\task-1168-29f8dc93' as string | null,
  executionCwdLine: '[Claude Code] Working directory: C:\\Projects\\temporaid\\.worktrees\\x',
};

mock.module('./supervisor-incident-evidence', () => ({
  gatherSupervisorEvidence: () =>
    Promise.resolve({
      ...evidence,
      failureMarkedAtMs: null,
      failureMarkSource: null,
      recoveryAtMs: null,
      successArtifactAtMs: null,
      successArtifactRef: null,
      backstopAtMs: null,
      lastProgressAtMs: null,
      lastProgressCause: null,
      verifyChecklist: { total: 0, noTargetCount: 0, samples: [] },
    }),
}));

const { inspectSupervisorSignatures, resetCwdMismatchFiledForTest } =
  await import('./supervisor-incident-inspect');

const task = {
  id: 1168,
  title: 't',
  status: 'in_progress',
  workflowStatus: null,
  updatedAt: new Date(NOW),
  themeId: 1,
  workflowDisabled: false,
};

const run = (file: Parameters<typeof inspectSupervisorSignatures>[0]['file']) =>
  inspectSupervisorSignatures({ task, state: {} as never, nowMs: NOW, file });

beforeEach(() => {
  resetCwdMismatchFiledForTest();
  evidence = {
    themeWorkingDirectory: 'C:\\Projects\\rapitas',
    taskWorkingDirectory: null,
    executionCwd: 'C:\\Projects\\temporaid\\.worktrees\\task-1168-29f8dc93',
    executionCwdLine: '[Claude Code] Working directory: C:\\Projects\\temporaid\\.worktrees\\x',
  };
});

describe('inspectSupervisorSignatures cwd-mismatch idempotency', () => {
  test('files once for identical evidence across repeated passes', async () => {
    const file = mock(() => Promise.resolve(true));
    expect(await run(file)).toBe(1);
    expect(await run(file)).toBe(0);
    expect(await run(file)).toBe(0);
    expect(file).toHaveBeenCalledTimes(1);
  });

  test('treats separator/case variants of the same cwd as the same evidence', async () => {
    const file = mock(() => Promise.resolve(true));
    await run(file);
    evidence.executionCwd = 'c:/projects/TEMPORAID/.worktrees/task-1168-29f8dc93/';
    await run(file);
    expect(file).toHaveBeenCalledTimes(1);
  });

  test('files again when the cwd changes (a genuine recurrence)', async () => {
    const file = mock(() => Promise.resolve(true));
    await run(file);
    evidence.executionCwd = 'C:\\Projects\\another-repo';
    await run(file);
    expect(file).toHaveBeenCalledTimes(2);
  });

  test('retries on the next pass when filing was not accepted', async () => {
    const file = mock(() => Promise.resolve(false));
    await run(file);
    await run(file);
    expect(file).toHaveBeenCalledTimes(2);
  });

  test('does not file when the cwd is inside the task working directory', async () => {
    evidence.taskWorkingDirectory = 'C:\\Projects\\temporaid';
    const file = mock(() => Promise.resolve(true));
    expect(await run(file)).toBe(0);
    expect(file).not.toHaveBeenCalled();
  });

  test('reports the task working directory in the evidence lines when present', async () => {
    evidence.taskWorkingDirectory = 'C:\\Projects\\somewhere-else';
    const file = mock((_args: { evidenceLines?: string[] }) => Promise.resolve(true));
    await run(file as never);
    const lines = file.mock.calls[0]?.[0].evidenceLines ?? [];
    expect(lines).toContain('タスク作業ディレクトリ: C:\\Projects\\somewhere-else');
  });

  test('the remembered set is bounded: the oldest key is evicted past 1000 entries', async () => {
    const file = mock(() => Promise.resolve(true));
    for (let i = 0; i < 1001; i++) {
      evidence.executionCwd = `C:\\Projects\\repo-${i}`;
      await run(file);
    }
    expect(file).toHaveBeenCalledTimes(1001);
    // repo-1000 is still remembered; repo-0 was evicted and is filed again.
    evidence.executionCwd = 'C:\\Projects\\repo-1000';
    await run(file);
    expect(file).toHaveBeenCalledTimes(1001);
    evidence.executionCwd = 'C:\\Projects\\repo-0';
    await run(file);
    expect(file).toHaveBeenCalledTimes(1002);
  });
});
