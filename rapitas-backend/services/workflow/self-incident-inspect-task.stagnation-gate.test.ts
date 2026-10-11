/**
 * self-incident-inspect-task.stagnation-gate.test
 *
 * Wiring coverage for task #1203: inspectTask must hand `haltReason` /
 * `autoRunExcluded` to detectStagnation so a task the auto-run selector never
 * picks is not filed as stagnant (reconciler_requeue leaves todo x in_progress).
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test';
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

async function stagnationFilings(task: CandidateTask): Promise<number> {
  fileFindingMock.mockClear();
  await inspectTask(task, NOW, new Set(), new Set(), false, 3, new Map(), new Set());
  return fileFindingMock.mock.calls.filter((c) => c[0].signature === 'stagnation').length;
}

describe('inspectTask stagnation gate wiring (#1203)', () => {
  beforeEach(() => fileFindingMock.mockClear());

  it('files stagnation for a plain orphaned todo x in_progress task', async () => {
    expect(await stagnationFilings(baseTask)).toBe(1);
  });

  it('does not file stagnation when autoRunExcluded is true', async () => {
    expect(await stagnationFilings({ ...baseTask, autoRunExcluded: true })).toBe(0);
  });

  it('does not file stagnation when haltReason is set', async () => {
    expect(await stagnationFilings({ ...baseTask, haltReason: 'iteration_budget' })).toBe(0);
  });

  it('still files stagnation when haltReason is null and autoRunExcluded is false', async () => {
    expect(await stagnationFilings({ ...baseTask, haltReason: null, autoRunExcluded: false })).toBe(
      1,
    );
  });
});
