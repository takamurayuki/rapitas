/**
 * task-terminal-current-release.test
 *
 * Covers CAS release of ThemeAutoRun.currentTaskId for terminal tasks (task 1009).
 */
import { describe, test, expect, mock } from 'bun:test';
import {
  releaseCurrentTaskIfMatches,
  releaseThemeCurrentOnTerminal,
} from './task-terminal-current-release';

function fake(count = 1, fail = false) {
  const updateMany = mock(() =>
    fail ? Promise.reject(new Error('db')) : Promise.resolve({ count }),
  );
  return { updateMany, prisma: { themeAutoRun: { updateMany } } };
}

describe('task-terminal-current-release', () => {
  test('releases only themes whose current task matches', async () => {
    const f = fake(1);
    expect(await releaseCurrentTaskIfMatches(f.prisma, 1008)).toBe(1);
    expect(f.updateMany).toHaveBeenCalledWith({
      where: { currentTaskId: 1008 },
      data: { currentTaskId: null },
    });
  });

  test.each(['cancelled', 'done'])('releases on %s', async (status) => {
    const f = fake();
    await releaseThemeCurrentOnTerminal(f.prisma, 1, status);
    expect(f.updateMany).toHaveBeenCalledTimes(1);
  });

  test('does not touch the theme for in-progress or undefined status', async () => {
    const f = fake();
    await releaseThemeCurrentOnTerminal(f.prisma, 1, 'in-progress');
    await releaseThemeCurrentOnTerminal(f.prisma, 1, undefined);
    expect(f.updateMany).not.toHaveBeenCalled();
  });

  test('swallows DB failures so the status update still succeeds', async () => {
    const f = fake(0, true);
    await releaseThemeCurrentOnTerminal(f.prisma, 1, 'cancelled');
    expect(f.updateMany).toHaveBeenCalledTimes(1);
  });
});
