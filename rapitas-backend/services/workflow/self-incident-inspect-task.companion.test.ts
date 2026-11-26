/**
 * self-incident-inspect-task.companion.test
 *
 * Task 1552: a COMPANION task (running next to the theme's head) is on its own
 * turn, so the "theme busy with another task → backlog wait" suppression must
 * not hide its stagnation. A task that merely waits behind the head is still
 * suppressed, as before.
 */
import { describe, it, expect, mock } from 'bun:test';
import type { GatheredTaskState } from './self-incident-evidence';
import type { CandidateTask } from './self-incident-file-finding';

const NOW = 1_000_000_000_000;
const STALE_MS = NOW - 3 * 60 * 60_000;

const stagnantState = {
  taskId: 1153,
  title: 'orphan',
  taskUpdatedAtMs: STALE_MS,
  timeline: [],
  latestTransitionAtMs: STALE_MS,
  latestTransitionCause: 'reconciler_requeue',
  windowedCauses: [],
  latestSessionId: null,
  latestSessionStatus: null,
  latestSessionUpdatedAtMs: null,
  latestExecutionId: null,
  latestExecutionStatus: null,
  hasLiveExecution: false,
  hasAnyExecution: true,
  hasActiveQueueItem: false,
  latestBlockedEscalationAtMs: null,
} as unknown as GatheredTaskState;

const fileFindingMock = mock(async (_args: { signature: string }) => true);

mock.module('./self-incident-evidence', () => ({
  gatherTaskState: async () => stagnantState,
}));
mock.module('./self-incident-file-finding', () => ({ fileFinding: fileFindingMock }));
mock.module('./supervisor-incident-inspect', () => ({
  inspectSupervisorSignatures: async () => 0,
}));

let lastDispatch: string | null = 'slot_busy';
mock.module('./blocked-retry-dispatch', () => ({
  readLastRetryDispatch: async () => lastDispatch,
  // Every export is mirrored: bun's mock.module is process-global and a partial
  // mock makes importers of the other names fail to load.
  ensureRetryDispatch: async () => 'error',
  resetBlockedTaskForRetry: async () => 'error',
}));
mock.module('../../config/database', () => ({ prisma: {} }));

const { inspectTask } = await import('./self-incident-inspect-task');

const baseTask: CandidateTask = {
  id: 1153,
  title: 'orphan',
  status: 'todo',
  workflowStatus: 'in_progress',
  updatedAt: new Date(STALE_MS),
  themeId: 1,
  workflowDisabled: false,
};

async function stagnationFilings(
  runState: Map<number, { currentTaskId: number | null; companionTaskIds?: number[] }>,
): Promise<number> {
  fileFindingMock.mockClear();
  await inspectTask(baseTask, NOW, new Set(), new Set(), false, 3, runState, new Set());
  return fileFindingMock.mock.calls.filter((c) => c[0].signature === 'stagnation').length;
}

describe('inspectTask — companion tasks (task 1552)', () => {
  it('a task waiting behind another head is a backlog wait (suppressed, as before)', async () => {
    expect(await stagnationFilings(new Map([[1, { currentTaskId: 999 }]]))).toBe(0);
  });

  it('a companion of that head is on its own turn → stagnation is filed', async () => {
    expect(
      await stagnationFilings(new Map([[1, { currentTaskId: 999, companionTaskIds: [1153] }]])),
    ).toBe(1);
  });

  it('a companion list without this task keeps the suppression', async () => {
    expect(
      await stagnationFilings(new Map([[1, { currentTaskId: 999, companionTaskIds: [77] }]])),
    ).toBe(0);
  });
});
