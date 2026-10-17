/**
 * runtime-config.screen-task.test
 *
 * Covers `isScreenTask`, which decides whether the reachability check demands
 * a registered entry. Getting this wrong in either direction is costly: true
 * for every task fails projects for work nobody assigned them, false for the
 * screen task leaves the pass-through that kept the check inert.
 *
 * `prisma` is mocked in its own file because `mock.module` is process-global.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const mockTaskFindUnique = mock(() => Promise.resolve<Record<string, unknown> | null>(null));
mock.module('../../../../config/database', () => ({
  ensureDatabaseConnection: () => Promise.resolve(),
  prisma: { task: { findUnique: mockTaskFindUnique } },
}));

const { isScreenTask } = await import('./runtime-config');

beforeEach(() => {
  mockTaskFindUnique.mockReset();
  mockTaskFindUnique.mockResolvedValue(null);
});

describe('isScreenTask', () => {
  test.each([
    ['a screen task', '[UI] ロビー', true],
    // The title is free text, so a stray leading space must not exempt a
    // screen task from the obligation.
    ['a screen task with leading whitespace', '  [UI] ロビー', true],
    ['a feature task', '[F-01] 音声読込と解析', false],
    ['the environment task', '[ENV] 環境構築', false],
    ['the spec gate task', '[SPEC] 要件定義の不足を埋める', false],
    ['the documentation task', '[DOC] 追随', false],
  ])('is %s → %p', async (_label, title, expected) => {
    mockTaskFindUnique.mockResolvedValue({ title });
    expect(await isScreenTask(7)).toBe(expected);
  });

  test('is false without a task id, so an adhoc run demands nothing', async () => {
    expect(await isScreenTask(undefined)).toBe(false);
    expect(await isScreenTask(null)).toBe(false);
    expect(mockTaskFindUnique).not.toHaveBeenCalled();
  });

  test('is false when the task is gone', async () => {
    mockTaskFindUnique.mockResolvedValue(null);
    expect(await isScreenTask(7)).toBe(false);
  });

  test('is false when the lookup throws, so a DB blip never invents a failure', async () => {
    mockTaskFindUnique.mockRejectedValue(new Error('ECONNREFUSED'));
    expect(await isScreenTask(7)).toBe(false);
  });
});
