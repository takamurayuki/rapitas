/**
 * critic-rejection-guard.test
 *
 * Unit tests for criticRejectedSince: file-type scoping, the time boundary,
 * and fail-open behavior on DB errors.
 */
import { describe, test, expect, beforeEach, mock } from 'bun:test';

const findFirst = mock<() => Promise<{ id: number } | null>>(() => Promise.resolve(null));

const noopLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

mock.module('../../../config/logger', () => ({ createLogger: () => noopLogger }));
mock.module('../../../config/database', () => ({
  prisma: { workflowTransition: { findFirst } },
  ensureDatabaseConnection: () => Promise.resolve(),
}));

const { criticRejectedSince } = await import('./critic-rejection-guard');

describe('criticRejectedSince', () => {
  beforeEach(() => {
    findFirst.mockReset().mockResolvedValue(null);
  });

  test('research で差し戻し遷移が見つかれば true', async () => {
    findFirst.mockResolvedValue({ id: 1 });
    const since = new Date('2026-08-07T17:00:00Z');
    expect(await criticRejectedSince(539, 'research', since)).toBe(true);
    expect(findFirst).toHaveBeenCalledTimes(1);
    const arg = (findFirst.mock.calls[0] as unknown as [Record<string, unknown>])[0];
    expect(arg).toEqual({
      where: {
        taskId: 539,
        cause: 'research_critic_failed',
        createdAt: { gt: since },
      },
      select: { id: true },
    });
  });

  test('plan は plan_critic_failed を検索する', async () => {
    findFirst.mockResolvedValue({ id: 2 });
    expect(await criticRejectedSince(1, 'plan', new Date())).toBe(true);
    const arg = (findFirst.mock.calls[0] as unknown as [{ where: { cause: string } }])[0];
    expect(arg.where.cause).toBe('plan_critic_failed');
  });

  test('差し戻し遷移が無ければ false', async () => {
    expect(await criticRejectedSince(539, 'research', new Date())).toBe(false);
  });

  test('critic 対象外の fileType は DB を見ずに false', async () => {
    expect(await criticRejectedSince(539, 'verify', new Date())).toBe(false);
    expect(await criticRejectedSince(539, 'question', new Date())).toBe(false);
    expect(findFirst).not.toHaveBeenCalled();
  });

  test('DB エラー時は fail-open で false（保存をブロックしない）', async () => {
    findFirst.mockRejectedValue(new Error('db down'));
    expect(await criticRejectedSince(539, 'research', new Date())).toBe(false);
  });
});
