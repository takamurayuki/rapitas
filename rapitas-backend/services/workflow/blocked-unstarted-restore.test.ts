/**
 * blocked-unstarted-restore.test
 *
 * AC3: a backstop block on a never-executed task is restored without a draft
 * reset; real failures / legacy rows / capped / halted keep the old path.
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test';

const mockRecordTransition = mock((_i: unknown) => Promise.resolve());
mock.module('./transition-recorder', () => ({ recordTransition: mockRecordTransition }));

const { restoreBlockedUnstartedTask, BLOCKED_UNSTARTED_RESTORE_CAUSE, MAX_UNSTARTED_RESTORES } =
  await import('./blocked-unstarted-restore');
const { HANG_BACKSTOP_CAUSE, NEVER_EXECUTED_SINCE_CURRENT_KEY } =
  await import('./auto-run/auto-run-hang-backstop-transition');

let latest: { cause: string; metadata: string } | null;
let restoreCount: number;
let failUpdate: boolean;
const update = mock((_a: unknown) =>
  failUpdate ? Promise.reject(new Error('db')) : Promise.resolve({}),
);
const prisma = {
  workflowTransition: {
    findFirst: () => Promise.resolve(latest),
    count: () => Promise.resolve(restoreCount),
  },
  task: { update },
};
const task = { id: 1153, workflowStatus: 'in_progress', haltReason: null };
const backstop = (flag: unknown) => ({
  cause: HANG_BACKSTOP_CAUSE,
  metadata: JSON.stringify(flag === undefined ? {} : { [NEVER_EXECUTED_SINCE_CURRENT_KEY]: flag }),
});

beforeEach(() => {
  latest = backstop(true);
  restoreCount = 0;
  failUpdate = false;
  update.mockClear();
  mockRecordTransition.mockClear();
});

describe('restoreBlockedUnstartedTask', () => {
  it('restores status=todo without touching workflowStatus', async () => {
    expect(await restoreBlockedUnstartedTask(prisma, task)).toBe('restored');
    const data = (update.mock.calls[0]?.[0] as { data: Record<string, unknown> }).data;
    expect(data.status).toBe('todo');
    expect('workflowStatus' in data).toBe(false);
    const rec = mockRecordTransition.mock.calls[0]?.[0] as { cause: string; toStatus: string };
    expect(rec.cause).toBe(BLOCKED_UNSTARTED_RESTORE_CAUSE);
    expect(rec.toStatus).toBe('in_progress');
  });

  it('is not applicable for a backstop block after the task actually ran', async () => {
    latest = backstop(false);
    expect(await restoreBlockedUnstartedTask(prisma, task)).toBe('not_applicable');
    expect(update).not.toHaveBeenCalled();
  });

  it('is not applicable for legacy backstop rows without the flag', async () => {
    latest = backstop(undefined);
    expect(await restoreBlockedUnstartedTask(prisma, task)).toBe('not_applicable');
  });

  it('is not applicable for a real-failure block cause', async () => {
    latest = { cause: 'phase_failed:implementer', metadata: '{}' };
    expect(await restoreBlockedUnstartedTask(prisma, task)).toBe('not_applicable');
  });

  it('is not applicable when the task has a haltReason', async () => {
    expect(await restoreBlockedUnstartedTask(prisma, { ...task, haltReason: 'budget' })).toBe(
      'not_applicable',
    );
    expect(update).not.toHaveBeenCalled();
  });

  it('leaves the task blocked (capped, no reset) after the restore cap', async () => {
    restoreCount = MAX_UNSTARTED_RESTORES;
    expect(await restoreBlockedUnstartedTask(prisma, task)).toBe('capped');
    expect(update).not.toHaveBeenCalled();
  });

  it('fails safe to capped when the update throws', async () => {
    failUpdate = true;
    expect(await restoreBlockedUnstartedTask(prisma, task)).toBe('capped');
  });

  it('keeps the old behaviour when the block cannot be classified', async () => {
    const broken = {
      ...prisma,
      workflowTransition: {
        ...prisma.workflowTransition,
        findFirst: () => Promise.reject(new Error('x')),
      },
    };
    expect(await restoreBlockedUnstartedTask(broken, task)).toBe('not_applicable');
  });

  it('restores from the exact metadata the backstop writer produces (key sharing)', async () => {
    const { recordHangBackstopBlock } =
      await import('./auto-run/auto-run-hang-backstop-transition');
    mockRecordTransition.mockClear();
    await recordHangBackstopBlock(
      1153,
      { status: 'in_progress', workflowStatus: 'in_progress' },
      45,
      true,
    );
    const written = mockRecordTransition.mock.calls[0]?.[0] as {
      cause: string;
      metadata: Record<string, unknown>;
    };
    latest = { cause: written.cause, metadata: JSON.stringify(written.metadata) };
    expect(await restoreBlockedUnstartedTask(prisma, task)).toBe('restored');
  });
});
