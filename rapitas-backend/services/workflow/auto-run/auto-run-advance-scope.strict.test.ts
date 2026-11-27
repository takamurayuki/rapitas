/**
 * auto-run-advance-scope.strict.test
 *
 * Task 1568: the scope-overlap context turns strict exactly while a task of the theme waits for CI.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import type { PrismaClient } from '../../../generated/prisma-postgres';

mock.module('./open-pr-files-cache', () => ({
  getPrChangedFiles: mock(async () => ['services/x.ts']),
}));
let waiting: unknown[] = [];
mock.module('../awaiting-ci-lookup', () => ({
  listAwaitingCi: mock(async () => waiting),
  isTaskAwaitingCi: mock(async () => false),
  isQueueItemHandedBack: mock(async () => false),
}));

const { buildScopeOverlapContext } = await import('./auto-run-advance-scope');

const prisma = {
  theme: { findUnique: mock(async () => ({ workingDirectory: '/repo' })) },
} as unknown as PrismaClient;

beforeEach(() => {
  waiting = [];
});

describe('buildScopeOverlapContext — strict', () => {
  test('a CI-waiting task of the theme makes the overlap wait strict', async () => {
    waiting = [{ taskId: 7 }];
    const ctx = await buildScopeOverlapContext(prisma, 1, [{ prNumber: 5 }]);
    expect(ctx?.strict).toBe(true);
    expect(ctx?.openPrFiles).toEqual(['services/x.ts']);
  });

  test('nothing waiting keeps the legacy starvation fallback', async () => {
    const ctx = await buildScopeOverlapContext(prisma, 1, [{ prNumber: 5 }]);
    expect(ctx?.strict).toBe(false);
  });

  test('no open PR → no context at all (legacy selection)', async () => {
    waiting = [{ taskId: 7 }];
    expect(await buildScopeOverlapContext(prisma, 1, [])).toBeUndefined();
  });
});
