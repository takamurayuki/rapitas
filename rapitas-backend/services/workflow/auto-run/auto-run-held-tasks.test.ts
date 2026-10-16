/**
 * auto-run-held-tasks test
 *
 * Pins the held-task classification: each hold reason counted once per task,
 * mid-finalization rows ignored, and the query errors resolving to "nothing held".
 */
import { describe, expect, test } from 'bun:test';
import { classifyHeldTasks, countHeldTasks, formatHeldTasks } from './auto-run-held-tasks';

describe('classifyHeldTasks', () => {
  test('groups open tasks by the flag that hides them from the selector', () => {
    // 2026-09-10: a supervisor set workflowDisabled on #911 as a "temporary
    // hold" and never restored it; the theme reported all_done for 15 days.
    const held = classifyHeldTasks([
      {
        id: 911,
        status: 'todo',
        workflowStatus: 'draft',
        workflowDisabled: true,
        autoRunExcluded: false,
      },
      {
        id: 907,
        status: 'todo',
        workflowStatus: 'in_progress',
        workflowDisabled: false,
        autoRunExcluded: true,
      },
      {
        id: 950,
        status: 'todo',
        workflowStatus: 'awaiting_question',
        workflowDisabled: false,
        autoRunExcluded: false,
      },
    ]);
    expect(held).toEqual({
      workflowDisabled: [911],
      autoRunExcluded: [907],
      awaitingQuestion: [950],
      total: 3,
    });
  });

  test('a task hidden by several flags is counted once, under the first reason', () => {
    const held = classifyHeldTasks([
      {
        id: 1,
        status: 'todo',
        workflowStatus: 'awaiting_question',
        workflowDisabled: true,
        autoRunExcluded: true,
      },
    ]);
    expect(held.total).toBe(1);
    expect(held.workflowDisabled).toEqual([1]);
    expect(held.autoRunExcluded).toEqual([]);
    expect(held.awaitingQuestion).toEqual([]);
  });

  test('mid-finalization rows and plain eligible rows are not held', () => {
    const held = classifyHeldTasks([
      {
        id: 2,
        status: 'in-progress',
        workflowStatus: 'verify_done',
        workflowDisabled: true,
        autoRunExcluded: false,
      },
      {
        id: 3,
        status: 'in-progress',
        workflowStatus: 'completed',
        workflowDisabled: false,
        autoRunExcluded: true,
      },
      {
        id: 4,
        status: 'todo',
        workflowStatus: 'draft',
        workflowDisabled: false,
        autoRunExcluded: false,
      },
    ]);
    expect(held.total).toBe(0);
  });
});

describe('countHeldTasks', () => {
  test('queries the theme and resolves a failed query to nothing held', async () => {
    const calls: unknown[] = [];
    const ok = {
      task: {
        findMany: async (args: unknown) => {
          calls.push(args);
          return [
            {
              id: 911,
              status: 'todo',
              workflowStatus: 'draft',
              workflowDisabled: true,
              autoRunExcluded: false,
            },
          ];
        },
      },
    } as unknown as Parameters<typeof countHeldTasks>[0];
    const held = await countHeldTasks(ok, 1);
    expect(held.workflowDisabled).toEqual([911]);
    expect((calls[0] as { where: { themeId: number } }).where.themeId).toBe(1);

    const broken = {
      task: { findMany: async () => Promise.reject(new Error('db down')) },
    } as unknown as Parameters<typeof countHeldTasks>[0];
    expect((await countHeldTasks(broken, 1)).total).toBe(0);
  });
});

describe('formatHeldTasks', () => {
  test('lists ids with their reason in a stable order', () => {
    expect(
      formatHeldTasks({
        workflowDisabled: [911],
        autoRunExcluded: [907],
        awaitingQuestion: [],
        total: 2,
      }),
    ).toBe('#911(workflowDisabled), #907(autoRunExcluded)');
  });
});
