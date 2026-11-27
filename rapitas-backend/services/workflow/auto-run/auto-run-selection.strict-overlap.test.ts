/**
 * auto-run-selection.strict-overlap.test
 *
 * Task 1568: while a task waits for CI its PR is still open, so a candidate that touches the same
 * files must NOT be started. The legacy all-overlap fallback (task 573 B, starvation guard) stays
 * for ordinary open PRs; `strict` turns it into a wait that the CI result always resolves.
 */
import { describe, it, expect, mock } from 'bun:test';
import { selectNextTask } from './auto-run-selection';
import type { PrismaClient } from '../../../generated/prisma-postgres';

function makePrisma(tasks: unknown[]): PrismaClient {
  return {
    workflowQueueItem: {
      count: mock().mockResolvedValue(0),
      findMany: mock().mockResolvedValue([]),
    },
    task: { findMany: mock().mockResolvedValue(tasks), count: mock().mockResolvedValue(0) },
    userSettings: { findFirst: mock().mockResolvedValue({ workflowDisabledGlobally: false }) },
  } as unknown as PrismaClient;
}

const base = new Date('2026-01-01T00:00:00Z').getTime();
const mkTask = (id: number, offsetMs: number, extra: Record<string, unknown> = {}) => ({
  id,
  status: 'todo',
  workflowStatus: null,
  priority: 'medium',
  createdAt: new Date(base + offsetMs),
  ...extra,
});

const overlapAll = (strict?: boolean) => ({
  openPrFiles: ['rapitas-backend/services/x.ts'],
  getPlanFiles: async () => ['services/x.ts'],
  strict,
});

describe('selectNextTask — strict scope overlap (CI wait)', () => {
  it('every candidate overlaps the CI-waiting PR: nothing is selected (a wait, not all_done)', async () => {
    const prisma = makePrisma([mkTask(100, 0), mkTask(101, 1000)]);
    const result = await selectNextTask(prisma, 1, 'priority', [], 0, null, overlapAll(true));
    expect(result).toEqual({ found: false, reason: 'all_overlap_deferred', deferred: [100, 101] });
  });

  it('without strict the legacy starvation guard still picks the head (unchanged)', async () => {
    const prisma = makePrisma([mkTask(100, 0), mkTask(101, 1000)]);
    const result = await selectNextTask(prisma, 1, 'priority', [], 0, null, overlapAll(false));
    expect(result).toEqual({ found: true, taskId: 100 });
  });

  it('strict with one non-overlapping candidate selects it and reports the deferred ones', async () => {
    const prisma = makePrisma([mkTask(100, 0), mkTask(101, 1000)]);
    const plan: Record<number, string[]> = { 100: ['services/x.ts'], 101: ['routes/other.ts'] };
    const result = await selectNextTask(prisma, 1, 'priority', [], 0, null, {
      openPrFiles: ['rapitas-backend/services/x.ts'],
      getPlanFiles: async (id) => plan[id] ?? [],
      strict: true,
    });
    expect(result).toEqual({ found: true, taskId: 101, deferred: [100] });
  });

  it('strict never strands an in-progress task that already owns a worktree', async () => {
    const prisma = makePrisma([
      mkTask(100, 0, { status: 'in-progress', workflowStatus: 'plan_approved' }),
    ]);
    const result = await selectNextTask(prisma, 1, 'priority', [], 0, null, overlapAll(true));
    expect(result).toEqual({ found: true, taskId: 100 });
  });

  it('strict with a plan-less (lightweight) candidate still selects it', async () => {
    const prisma = makePrisma([mkTask(100, 0)]);
    const result = await selectNextTask(prisma, 1, 'priority', [], 0, null, {
      openPrFiles: ['services/x.ts'],
      getPlanFiles: async () => [],
      strict: true,
    });
    expect(result).toEqual({ found: true, taskId: 100 });
  });

  it('the parallel-filter walk is strict too: an overlapping fallback is not taken', async () => {
    const prisma = makePrisma([mkTask(100, 0), mkTask(101, 1000)]);
    // Accepts every candidate; only the overlap decides.
    const filter = async () => ({ ok: true as const });
    const result = await selectNextTask(
      prisma,
      1,
      'priority',
      [],
      0,
      null,
      overlapAll(true),
      filter,
    );
    expect(result).toMatchObject({ found: false, reason: 'all_overlap_deferred' });
  });
});
