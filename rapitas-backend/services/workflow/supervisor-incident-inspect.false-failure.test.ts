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
});
