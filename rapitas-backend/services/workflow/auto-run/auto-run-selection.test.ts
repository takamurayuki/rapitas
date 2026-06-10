/**
 * auto-run-selection.test.ts
 *
 * Unit tests for the pure selection logic in auto-run-selection.ts.
 * Uses an in-memory mock of the PrismaClient — no live DB required.
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test';
import {
  AUTO_RUN_GLOBAL_MAX_CONCURRENCY,
  getGlobalAutoRunActiveCount,
  getThemeActiveQueueItems,
  hasItemAwaitingApproval,
  selectNextTask,
  isTaskBlocked,
} from './auto-run-selection';
import type { PrismaClient } from '@prisma/client';

// ---------------------------------------------------------------------------
// Minimal Prisma mock
// ---------------------------------------------------------------------------

function makePrisma(overrides: Partial<Record<string, unknown>> = {}): PrismaClient {
  return {
    workflowQueueItem: {
      count: mock().mockResolvedValue(0),
      findMany: mock().mockResolvedValue([]),
    },
    task: {
      findMany: mock().mockResolvedValue([]),
    },
    ...overrides,
  } as unknown as PrismaClient;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('isTaskBlocked', () => {
  it('returns true for blocked status', () => {
    expect(isTaskBlocked('blocked')).toBe(true);
  });

  it('returns false for todo/in-progress', () => {
    expect(isTaskBlocked('todo')).toBe(false);
    expect(isTaskBlocked('in-progress')).toBe(false);
    expect(isTaskBlocked('done')).toBe(false);
  });
});

describe('hasItemAwaitingApproval', () => {
  it('returns true when any item is waiting_approval', () => {
    expect(hasItemAwaitingApproval([{ status: 'running' }, { status: 'waiting_approval' }])).toBe(
      true,
    );
  });

  it('returns false when no item is waiting_approval', () => {
    expect(hasItemAwaitingApproval([{ status: 'running' }, { status: 'queued' }])).toBe(false);
  });

  it('returns false for empty array', () => {
    expect(hasItemAwaitingApproval([])).toBe(false);
  });
});

describe('getGlobalAutoRunActiveCount', () => {
  it('calls count with themeId not null and active statuses', async () => {
    const mockCount = mock().mockResolvedValue(2);
    const prisma = makePrisma({
      workflowQueueItem: { count: mockCount, findMany: mock() },
    });
    const result = await getGlobalAutoRunActiveCount(prisma);
    expect(result).toBe(2);
    expect(mockCount).toHaveBeenCalledWith({
      where: {
        themeId: { not: null },
        status: { in: ['queued', 'running', 'waiting_approval'] },
      },
    });
  });
});

describe('getThemeActiveQueueItems', () => {
  it('scopes query to themeId and active statuses', async () => {
    const mockFindMany = mock().mockResolvedValue([{ id: 1, taskId: 42, status: 'running' }]);
    const prisma = makePrisma({
      workflowQueueItem: { findMany: mockFindMany, count: mock() },
    });
    const items = await getThemeActiveQueueItems(prisma, 7);
    expect(items).toHaveLength(1);
    expect(mockFindMany).toHaveBeenCalledWith({
      where: { themeId: 7, status: { in: ['queued', 'running', 'waiting_approval'] } },
      select: { id: true, taskId: true, status: true },
    });
  });
});

describe('selectNextTask', () => {
  // NOTE: mocks are created fresh per test via makePrisma(), so no global reset needed.
  beforeEach(() => {});

  it('returns concurrency_limit when globalActiveCount >= MAX', async () => {
    const prisma = makePrisma();
    const result = await selectNextTask(prisma, 1, 'priority', [], AUTO_RUN_GLOBAL_MAX_CONCURRENCY);
    expect(result).toEqual({ found: false, reason: 'concurrency_limit' });
  });

  it('returns all_done when no eligible tasks exist', async () => {
    const mockFindMany = mock().mockResolvedValue([]);
    const prisma = makePrisma({ task: { findMany: mockFindMany } });
    const result = await selectNextTask(prisma, 1, 'priority', [], 0);
    expect(result).toEqual({ found: false, reason: 'all_done' });
  });

  it('returns found with taskId for an eligible task', async () => {
    const tasks = [
      { id: 10, status: 'todo', workflowStatus: 'draft', priority: 'high', createdAt: new Date() },
    ];
    const mockFindMany = mock().mockResolvedValue(tasks);
    const prisma = makePrisma({ task: { findMany: mockFindMany } });
    const result = await selectNextTask(prisma, 1, 'priority', [], 0);
    expect(result).toEqual({ found: true, taskId: 10 });
  });

  it('skips blocked tasks', async () => {
    const tasks = [
      {
        id: 10,
        status: 'blocked',
        workflowStatus: 'draft',
        priority: 'high',
        createdAt: new Date(),
      },
      {
        id: 11,
        status: 'todo',
        workflowStatus: 'draft',
        priority: 'medium',
        createdAt: new Date(),
      },
    ];
    const mockFindMany = mock().mockResolvedValue(tasks);
    const prisma = makePrisma({ task: { findMany: mockFindMany } });
    const result = await selectNextTask(prisma, 1, 'priority', [], 0);
    expect(result).toEqual({ found: true, taskId: 11 });
  });

  it('skips tasks in skipTaskIds', async () => {
    const tasks = [
      {
        id: 5,
        status: 'todo',
        workflowStatus: 'in_progress',
        priority: 'high',
        createdAt: new Date(),
      },
    ];
    const mockFindMany = mock().mockResolvedValue(tasks);
    const prisma = makePrisma({ task: { findMany: mockFindMany } });
    await selectNextTask(prisma, 1, 'priority', [5], 0);
    // findMany is called with id: { notIn: [5] } so the mock still returns it;
    // but in a real DB it would be filtered. We verify the where clause instead.
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { notIn: [5] } }),
      }),
    );
  });

  it('passes correct orderBy for "created" order', async () => {
    const mockFindMany = mock().mockResolvedValue([]);
    const prisma = makePrisma({ task: { findMany: mockFindMany } });
    await selectNextTask(prisma, 1, 'created', [], 0);
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: [{ createdAt: 'asc' }] }),
    );
  });

  it('ranks string priority in JS (DB orderBy stays createdAt-asc)', async () => {
    const base = new Date('2026-01-01T00:00:00Z').getTime();
    const tasks = [
      { id: 1, status: 'todo', workflowStatus: null, priority: 'low', createdAt: new Date(base) },
      {
        id: 2,
        status: 'todo',
        workflowStatus: null,
        priority: 'urgent',
        createdAt: new Date(base + 1000),
      },
      {
        id: 3,
        status: 'todo',
        workflowStatus: null,
        priority: 'high',
        createdAt: new Date(base + 2000),
      },
    ];
    const mockFindMany = mock().mockResolvedValue(tasks);
    const prisma = makePrisma({ task: { findMany: mockFindMany } });
    const result = await selectNextTask(prisma, 1, 'priority', [], 0);
    // urgent wins even though it is neither first nor oldest — proves JS ranking,
    // not the broken SQL string `desc` (which would have picked 'urgent'>'medium'>'low'>'high').
    expect(result).toEqual({ found: true, taskId: 2 });
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: [{ createdAt: 'asc' }] }),
    );
  });

  it('breaks a priority tie by creation order (oldest first)', async () => {
    const base = new Date('2026-01-01T00:00:00Z').getTime();
    const tasks = [
      {
        id: 10,
        status: 'todo',
        workflowStatus: null,
        priority: 'high',
        createdAt: new Date(base + 5000),
      },
      {
        id: 11,
        status: 'todo',
        workflowStatus: null,
        priority: 'high',
        createdAt: new Date(base + 1000),
      },
    ];
    const prisma = makePrisma({ task: { findMany: mock().mockResolvedValue(tasks) } });
    const result = await selectNextTask(prisma, 1, 'priority', [], 0);
    expect(result).toEqual({ found: true, taskId: 11 });
  });

  it('keeps fresh todo tasks (null workflowStatus) eligible', async () => {
    // Regression: `notIn` alone drops NULLs in SQL, which skipped brand-new tasks.
    // The where clause must OR-in `workflowStatus: null`.
    const mockFindMany = mock().mockResolvedValue([]);
    const prisma = makePrisma({ task: { findMany: mockFindMany } });
    await selectNextTask(prisma, 1, 'priority', [], 0);
    const arg = mockFindMany.mock.calls[0]![0] as { where: { OR?: unknown[] } };
    expect(arg.where.OR).toEqual(expect.arrayContaining([{ workflowStatus: null }]));
  });
});
