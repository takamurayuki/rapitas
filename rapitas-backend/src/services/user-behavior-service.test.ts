/**
 * user-behavior-service tests
 *
 * Pins how a completed task finds its existing TaskPattern row (#1309): without
 * the compound-unique shorthand (it now carries workspaceId), and with the
 * task's real themeId — the old `themeId || 0` lookup never matched the
 * `themeId: null` rows the same code creates, so every completion of a task
 * without a theme added another row.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const noop = () => {};
mock.module('../../config/logger', () => ({
  createLogger: () => ({ info: noop, warn: noop, error: noop, debug: noop }),
}));

const findFirst = mock((_args: unknown) => Promise.resolve<unknown>(null));
const findUnique = mock((_args: unknown) => Promise.resolve<unknown>(null));
const update = mock((_args: unknown) => Promise.resolve({}));
const create = mock((_args: unknown) => Promise.resolve({}));

mock.module('../../config/database', () => ({
  prisma: {
    userBehavior: { create: mock(() => Promise.resolve({})) },
    taskPattern: { findFirst, findUnique, update, create },
  },
}));

const { UserBehaviorService } = await import('./user-behavior-service');

const task = (themeId: number | null) => ({
  title: 'Write the weekly report',
  priority: 'medium',
  themeId,
  createdAt: new Date('2026-11-01T00:00:00Z'),
  startedAt: new Date('2026-11-01T01:00:00Z'),
  completedAt: new Date('2026-11-01T03:00:00Z'),
});

beforeEach(() => {
  for (const m of [findFirst, findUnique, update, create]) m.mockClear();
  findFirst.mockResolvedValue(null);
});

describe('UserBehaviorService.recordTaskCompleted — TaskPattern lookup (#1309)', () => {
  test('looks the pattern up with findFirst on the plain fields, not the compound key', async () => {
    await UserBehaviorService.recordTaskCompleted(1, task(7));
    expect(findUnique).not.toHaveBeenCalled();
    expect(findFirst).toHaveBeenCalledWith({
      where: { userId: 1, taskTitle: 'Write the weekly report', themeId: 7 },
    });
  });

  test('a task without a theme finds the themeId:null row it created, and updates it', async () => {
    findFirst.mockImplementation(async (args: unknown) => {
      const where = (args as { where: { themeId: unknown } }).where;
      // The row this service creates for a theme-less task has themeId null.
      return where.themeId === null
        ? { id: 5, frequency: 1, averageTimeToStart: 1, averageTimeToComplete: 2 }
        : null;
    });
    await UserBehaviorService.recordTaskCompleted(1, task(null));
    expect(update).toHaveBeenCalledTimes(1);
    expect(create).not.toHaveBeenCalled();
  });

  test('creates a row stamped with the same themeId it looks up by', async () => {
    await UserBehaviorService.recordTaskCompleted(1, task(null));
    const lookedUp = (findFirst.mock.calls[0][0] as { where: { themeId: unknown } }).where.themeId;
    const created = (create.mock.calls[0][0] as { data: { themeId: unknown } }).data.themeId;
    expect(created).toBe(lookedUp);
  });
});
