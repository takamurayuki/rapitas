/**
 * workflow-disabled テスト
 *
 * resolveEffectiveWorkflowDisabled's task-level / global OR precedence, and
 * its behavior when the task is missing.
 */
import { describe, test, expect, beforeEach, mock } from 'bun:test';

type UserSettings = { workflowDisabledGlobally?: boolean } | null;
type TaskRow = { workflowDisabled?: boolean } | null;

let userSettings: UserSettings = null;
let taskRow: TaskRow = null;

mock.module('../../config/database', () => ({
  prisma: {
    userSettings: { findFirst: () => Promise.resolve(userSettings) },
    task: { findUnique: () => Promise.resolve(taskRow) },
  },
}));

const { resolveEffectiveWorkflowDisabled } = await import('./workflow-disabled');

beforeEach(() => {
  userSettings = null;
  taskRow = null;
});

describe('resolveEffectiveWorkflowDisabled', () => {
  test('false when neither task-level nor global flag is set', async () => {
    taskRow = { workflowDisabled: false };
    userSettings = { workflowDisabledGlobally: false };
    expect(await resolveEffectiveWorkflowDisabled(1)).toBe(false);
  });

  test('true when only the task-level flag is set', async () => {
    taskRow = { workflowDisabled: true };
    userSettings = { workflowDisabledGlobally: false };
    expect(await resolveEffectiveWorkflowDisabled(1)).toBe(true);
  });

  test('true when only the global flag is set', async () => {
    taskRow = { workflowDisabled: false };
    userSettings = { workflowDisabledGlobally: true };
    expect(await resolveEffectiveWorkflowDisabled(1)).toBe(true);
  });

  test('false when the task does not exist, even if global is set', async () => {
    taskRow = null;
    userSettings = { workflowDisabledGlobally: true };
    expect(await resolveEffectiveWorkflowDisabled(999)).toBe(false);
  });

  test('false when settings row is missing (fresh install)', async () => {
    taskRow = { workflowDisabled: false };
    userSettings = null;
    expect(await resolveEffectiveWorkflowDisabled(1)).toBe(false);
  });
});
