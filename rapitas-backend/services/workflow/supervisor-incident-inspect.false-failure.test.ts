/**
 * supervisor-incident-inspect.false-failure.test
 *
 * The false-failure signature must be filed once per task, not on every watch tick.
 */
import { beforeEach, describe, expect, mock, test } from 'bun:test';

const NOW = Date.parse('2026-10-07T00:00:00.000Z');
mock.module('./supervisor-incident-evidence', () => ({
  gatherSupervisorEvidence: () =>
    Promise.resolve({
      themeWorkingDirectory: null,
      executionCwd: null,
      executionCwdLine: null,
      failureMarkedAtMs: NOW,
      failureMarkSource: 'WorkflowQueueItem(failed).completedAt',
      recoveryAtMs: null,
      successArtifactAtMs: NOW + 60_000,
      successArtifactRef: 'PR #1',
      backstopAtMs: null,
      lastProgressAtMs: null,
      lastProgressCause: null,
      verifyChecklist: { total: 0, noTargetCount: 0, samples: [] },
    }),
}));

const { inspectSupervisorSignatures, resetFalseFailureFiledForTest } =
  await import('./supervisor-incident-inspect');

const task = {
  id: 1116,
  title: 't',
  status: 'in_progress',
  workflowStatus: null,
  updatedAt: new Date(NOW),
  themeId: 1,
  workflowDisabled: false,
};

beforeEach(() => resetFalseFailureFiledForTest());

describe('inspectSupervisorSignatures false-failure idempotency', () => {
  test('files once for the same taskId across repeated passes', async () => {
    const file = mock(() => Promise.resolve(true));
    const run = () => inspectSupervisorSignatures({ task, state: {} as never, nowMs: NOW, file });
    expect(await run()).toBe(1);
    expect(await run()).toBe(0);
    expect(file).toHaveBeenCalledTimes(1);
  });

  test('retries on the next pass when filing was not accepted', async () => {
    const file = mock(() => Promise.resolve(false));
    const run = () => inspectSupervisorSignatures({ task, state: {} as never, nowMs: NOW, file });
    await run();
    await run();
    expect(file).toHaveBeenCalledTimes(2);
  });
  test('does not re-file a success artifact older than the fresh window after a restart (#1220 recurrence)', async () => {
    // The idempotency Set is empty here, as after a backend restart. The artifact was already
    // observed by earlier ticks hours ago; re-filing it is the "再発" #1220 produced at 03:14Z.
    const file = mock(() => Promise.resolve(true));
    const hoursLater = NOW + 60_000 + 3 * 60 * 60_000;
    const filed = await inspectSupervisorSignatures({
      task,
      state: {} as never,
      nowMs: hoursLater,
      file,
    });
    expect(filed).toBe(0);
    expect(file).not.toHaveBeenCalled();
  });

  test('still files while the success artifact is fresh', async () => {
    const file = mock(() => Promise.resolve(true));
    const filed = await inspectSupervisorSignatures({
      task,
      state: {} as never,
      nowMs: NOW + 60_000 + 5 * 60_000,
      file,
    });
    expect(filed).toBe(1);
  });
});
