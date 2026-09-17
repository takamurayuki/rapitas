import { beforeEach, expect, mock, test } from 'bun:test';

// Task #964: reproduces the scenario reported against a prior commit
// (task-901-bdcadc9a) where a question save's pre-lock currentStatus
// snapshot could overwrite a completion that landed while waiting for
// withTaskLifecycleLock. Run against the current status-transition.ts to
// confirm the questionSnapshot re-read + CAS update (added by task901,
// see status-transition.ts:54-69, 280-297) still prevents the overwrite.

let workflowStatus = 'in_progress';
let status = 'in-progress';
let updatedAt = new Date(0);
const recordTransition = mock(async (_args: unknown) => {});
const updateMany = mock(
  async ({
    where,
    data,
  }: {
    where: { status: string; workflowStatus: string; updatedAt: Date };
    data: { workflowStatus: string };
  }) => {
    if (
      where.status !== status ||
      where.workflowStatus !== workflowStatus ||
      where.updatedAt.getTime() !== updatedAt.getTime()
    )
      return { count: 0 };
    workflowStatus = data.workflowStatus;
    return { count: 1 };
  },
);
beforeEach(() => {
  workflowStatus = 'in_progress';
  status = 'in-progress';
  updatedAt = new Date(0);
  updateMany.mockClear();
  recordTransition.mockClear();
});
mock.module('../../../../config', () => ({
  prisma: {
    workflowTransition: {
      findFirst: async () => null,
    },
    task: {
      findUnique: async () => ({ workflowStatus, status, updatedAt }),
      updateMany,
      update: async ({ data }: { data: { workflowStatus?: string } }) => {
        if (data.workflowStatus) workflowStatus = data.workflowStatus;
        return { workflowStatus };
      },
    },
  },
}));
mock.module('../../../../config/logger', () => ({
  createLogger: () => ({
    info() {},
    warn() {},
    error() {},
    debug() {},
  }),
}));
mock.module('../../../../services/workflow/completion-gate', () => ({
  researchConcludesNoChange: () => false,
}));
mock.module('../../../../services/workflow/transition-recorder', () => ({ recordTransition }));
mock.module('../../../../services/workflow/workflow-invariants', () => ({
  checkWorkflowInvariants: async () => [],
}));
mock.module('../../../../services/workflow/verify-invariant-repair', () => ({
  attemptInvariantCutoff: async () => false,
}));
mock.module('./shared', () => ({
  markLatestExecutionFailed: async () => {},
  wasNonConvergenceCutoffJustRecorded: async () => false,
}));

const { computeAndApplyStatusTransition } = await import('./status-transition');
const { withTaskLifecycleLock } = await import('../../../../services/workflow/task-lifecycle-lock');

test('supervisor question save must not overwrite completion reached while waiting for the lock', async () => {
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const completing = withTaskLifecycleLock(964, async () => {
    entered();
    await gate;
    workflowStatus = 'completed';
  });
  await started;
  // Matches the production caller (workflow-handlers-files.ts, task #964
  // fix): question saves pass currentStatus: null so no pre-lock snapshot
  // can ever be mistaken for the live status; the real value is re-read
  // under the lock via questionSnapshot.
  const saving = withTaskLifecycleLock(964, () =>
    computeAndApplyStatusTransition({
      taskId: 964,
      fileType: 'question',
      currentStatus: null,
      savedContent: 'Q',
    }),
  );
  release();
  await Promise.all([completing, saving]);
  expect(workflowStatus).toBe('completed');
  expect(recordTransition).not.toHaveBeenCalled();
});
