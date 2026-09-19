/**
 * self-incident-watch-gates.test
 *
 * Unit tests for resolveArmedThemeIds (task 977): must return exactly the
 * theme ids whose blocked-task retry/escalation pipeline is armed
 * (ThemeAutoRun.enabled=true && status='running'), matching
 * workflow-reconciler-blocked.ts's findBlockedCandidates armed query.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const mockPrisma = {
  themeAutoRun: { findMany: mock(() => Promise.resolve([] as { themeId: number }[])) },
};

mock.module('../../config/database', () => ({
  prisma: mockPrisma,
  ensureDatabaseConnection: () => Promise.resolve(),
}));

const { resolveArmedThemeIds } = await import('./self-incident-watch-gates');

beforeEach(() => {
  mockPrisma.themeAutoRun.findMany.mockReset().mockResolvedValue([]);
});

describe('resolveArmedThemeIds', () => {
  test('empty input returns an empty set without querying', async () => {
    const result = await resolveArmedThemeIds([]);
    expect(result).toEqual(new Set());
    expect(mockPrisma.themeAutoRun.findMany).not.toHaveBeenCalled();
  });

  test('returns only armed (enabled=true, status=running) theme ids', async () => {
    mockPrisma.themeAutoRun.findMany.mockResolvedValueOnce([{ themeId: 5 }, { themeId: 9 }]);

    const result = await resolveArmedThemeIds([5, 6, 9]);

    expect(result).toEqual(new Set([5, 9]));
    expect(mockPrisma.themeAutoRun.findMany).toHaveBeenCalledWith({
      where: { themeId: { in: [5, 6, 9] }, enabled: true, status: 'running' },
      select: { themeId: true },
    });
  });

  test('query failure falls back to an empty set (fail-open — detection keeps working)', async () => {
    mockPrisma.themeAutoRun.findMany.mockRejectedValueOnce(new Error('db unavailable'));

    const result = await resolveArmedThemeIds([5]);

    expect(result).toEqual(new Set());
  });
});
