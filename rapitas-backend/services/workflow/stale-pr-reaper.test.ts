/**
 * stale-pr-reaper.test.ts
 *
 * Unit tests for the stale auto-PR reaper (task 1061): closes an exhausted +
 * head-unchanged + CONFLICTING/DIRTY + aged auto-PR via gh, syncs DB state,
 * appends a task-description note, and files a concern. gh/Prisma/concern
 * filing are all injected — no real network or DB.
 */
import { describe, it, expect, mock } from 'bun:test';
import { reapStalePrs, MAX_REAP_PER_TICK, type StalePrReaperDeps } from './stale-pr-reaper';
import type { PrismaClient } from '../../generated/prisma-postgres';

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-09-24T00:00:00Z');

function makeExhaustionRow(headSha: string, ageMs: number) {
  return {
    cause: 'auto_merge_exhausted',
    metadata: JSON.stringify({ headSha }),
    createdAt: new Date(NOW - ageMs),
  };
}

function makePrisma(overrides: {
  candidates?: Array<{
    id: number;
    integrationId: number;
    prNumber: number;
    linkedTaskId: number | null;
  }>;
  exhaustionRow?: unknown;
  task?: {
    id: number;
    themeId: number | null;
    description: string | null;
    workingDirectory: string | null;
    theme: { workingDirectory: string | null } | null;
  } | null;
  updateManyImpl?: () => Promise<unknown>;
  taskUpdateImpl?: () => Promise<unknown>;
}) {
  const findMany = mock(async () => overrides.candidates ?? []);
  const workflowTransitionFindFirst = mock(async () => overrides.exhaustionRow ?? null);
  const taskFindUnique = mock(async () => overrides.task ?? null);
  const updateMany = mock(overrides.updateManyImpl ?? (async () => ({ count: 1 })));
  const taskUpdate = mock(overrides.taskUpdateImpl ?? (async () => ({})));
  return {
    prisma: {
      gitHubPullRequest: { findMany, updateMany },
      workflowTransition: { findFirst: workflowTransitionFindFirst },
      task: { findUnique: taskFindUnique, update: taskUpdate },
    } as unknown as PrismaClient,
    findMany,
    workflowTransitionFindFirst,
    taskFindUnique,
    updateMany,
    taskUpdate,
  };
}

const REAL_CWD = process.cwd(); // guaranteed to exist for existsSync

function makeTask(
  overrides: Partial<{
    id: number;
    themeId: number | null;
    description: string | null;
    workingDirectory: string | null;
    theme: { workingDirectory: string | null } | null;
  }> = {},
) {
  return {
    id: 1,
    themeId: 9,
    description: '既存の説明',
    workingDirectory: REAL_CWD,
    theme: null,
    ...overrides,
  };
}

describe('reapStalePrs', () => {
  it('closes a PR that meets all conditions: exhausted, head-matched, CONFLICTING/DIRTY, aged ≥7 days', async () => {
    const { prisma, updateMany, taskUpdate } = makePrisma({
      candidates: [{ id: 1, integrationId: 5, prNumber: 900, linkedTaskId: 1 }],
      exhaustionRow: makeExhaustionRow('sha-x', SEVEN_DAYS_MS + 1000),
      task: makeTask(),
    });
    const execCalls: string[] = [];
    const submitConcernMock = mock(async () => ({
      id: 1,
      outcome: 'created' as const,
      reason: 'new' as const,
      stored: true,
    }));
    const deps: Partial<StalePrReaperDeps> = {
      now: () => NOW,
      submitConcern: submitConcernMock,
      execGh: async (command) => {
        execCalls.push(command);
        if (command.includes('pr view')) {
          return JSON.stringify({
            mergeable: 'CONFLICTING',
            mergeStateStatus: 'DIRTY',
            headRefOid: 'sha-x',
          });
        }
        return '';
      },
    };

    const result = await reapStalePrs(prisma, deps);

    expect(result.closedPrNumbers).toEqual([900]);
    const closeCalls = execCalls.filter((c) => c.includes('pr close'));
    expect(closeCalls.length).toBe(1);
    expect(closeCalls[0]).toContain('900');
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(taskUpdate).toHaveBeenCalledTimes(1);
    expect(submitConcernMock).toHaveBeenCalledTimes(1);
    expect(submitConcernMock.mock.calls[0]![0]).toMatchObject({
      originTaskId: 1,
      themeId: 9,
      dedupKey: 'stale-pr-reaper:900',
    });
  });

  it('skips a PR with no exhaustion mark', async () => {
    const { prisma } = makePrisma({
      candidates: [{ id: 1, integrationId: 5, prNumber: 901, linkedTaskId: 1 }],
      exhaustionRow: null,
      task: makeTask(),
    });
    const execGh = mock(async () => '');
    const result = await reapStalePrs(prisma, { now: () => NOW, execGh });
    expect(result.closedPrNumbers).toEqual([]);
    expect(execGh.mock.calls.filter(([c]) => c.includes('pr close')).length).toBe(0);
  });

  it('skips an exhausted PR whose head SHA has moved (live retry)', async () => {
    const { prisma } = makePrisma({
      candidates: [{ id: 1, integrationId: 5, prNumber: 902, linkedTaskId: 1 }],
      exhaustionRow: makeExhaustionRow('sha-old', SEVEN_DAYS_MS + 1000),
      task: makeTask(),
    });
    const execGh = mock(async (command: string) => {
      if (command.includes('pr view')) {
        return JSON.stringify({
          mergeable: 'CONFLICTING',
          mergeStateStatus: 'DIRTY',
          headRefOid: 'sha-new-push',
        });
      }
      return '';
    });
    const result = await reapStalePrs(prisma, { now: () => NOW, execGh });
    expect(result.closedPrNumbers).toEqual([]);
    expect(execGh.mock.calls.filter(([c]) => c.includes('pr close')).length).toBe(0);
  });

  it('skips an exhausted+head-matched PR that has not aged 7 days yet', async () => {
    const { prisma } = makePrisma({
      candidates: [{ id: 1, integrationId: 5, prNumber: 903, linkedTaskId: 1 }],
      exhaustionRow: makeExhaustionRow('sha-x', SEVEN_DAYS_MS - 60_000), // ~6.99 days
      task: makeTask(),
    });
    const execGh = mock(async () => '');
    const result = await reapStalePrs(prisma, { now: () => NOW, execGh });
    expect(result.closedPrNumbers).toEqual([]);
    // Age gate is checked BEFORE any gh call — confirms the 6.9-day boundary is
    // rejected without even reading the merge state.
    expect(execGh).not.toHaveBeenCalled();
  });

  it('closes right at the 7-day boundary (7.0 days exactly)', async () => {
    const { prisma } = makePrisma({
      candidates: [{ id: 1, integrationId: 5, prNumber: 9031, linkedTaskId: 1 }],
      exhaustionRow: makeExhaustionRow('sha-x', SEVEN_DAYS_MS),
      task: makeTask(),
    });
    const execGh = mock(async (command: string) => {
      if (command.includes('pr view')) {
        return JSON.stringify({
          mergeable: 'CONFLICTING',
          mergeStateStatus: 'DIRTY',
          headRefOid: 'sha-x',
        });
      }
      return '';
    });
    const submitConcernMock = mock(async () => ({
      id: 1,
      outcome: 'created' as const,
      reason: 'new' as const,
      stored: true,
    }));
    const result = await reapStalePrs(prisma, {
      now: () => NOW,
      execGh,
      submitConcern: submitConcernMock,
    });
    expect(result.closedPrNumbers).toEqual([9031]);
  });

  it('skips an exhausted+head-matched+aged PR that is MERGEABLE/CLEAN (not stale)', async () => {
    const { prisma } = makePrisma({
      candidates: [{ id: 1, integrationId: 5, prNumber: 904, linkedTaskId: 1 }],
      exhaustionRow: makeExhaustionRow('sha-x', SEVEN_DAYS_MS + 1000),
      task: makeTask(),
    });
    const execGh = mock(async (command: string) => {
      if (command.includes('pr view')) {
        return JSON.stringify({
          mergeable: 'MERGEABLE',
          mergeStateStatus: 'CLEAN',
          headRefOid: 'sha-x',
        });
      }
      return '';
    });
    const result = await reapStalePrs(prisma, { now: () => NOW, execGh });
    expect(result.closedPrNumbers).toEqual([]);
    expect(execGh.mock.calls.filter(([c]) => c.includes('pr close')).length).toBe(0);
  });

  it('does not sync DB/description/concern when `gh pr close` throws (fail-open)', async () => {
    const { prisma, updateMany, taskUpdate } = makePrisma({
      candidates: [{ id: 1, integrationId: 5, prNumber: 905, linkedTaskId: 1 }],
      exhaustionRow: makeExhaustionRow('sha-x', SEVEN_DAYS_MS + 1000),
      task: makeTask(),
    });
    const submitConcernMock = mock(async () => ({
      id: 1,
      outcome: 'created' as const,
      reason: 'new' as const,
      stored: true,
    }));
    const execGh = mock(async (command: string) => {
      if (command.includes('pr view')) {
        return JSON.stringify({
          mergeable: 'CONFLICTING',
          mergeStateStatus: 'DIRTY',
          headRefOid: 'sha-x',
        });
      }
      if (command.includes('pr close')) {
        throw new Error('gh network error');
      }
      return '';
    });

    const result = await reapStalePrs(prisma, {
      now: () => NOW,
      execGh,
      submitConcern: submitConcernMock,
    });

    expect(result.closedPrNumbers).toEqual([]);
    expect(updateMany).not.toHaveBeenCalled();
    expect(taskUpdate).not.toHaveBeenCalled();
    expect(submitConcernMock).not.toHaveBeenCalled();
  });

  it('caps closures at MAX_REAP_PER_TICK (3) even when 4 candidates all qualify', async () => {
    const candidates = [1, 2, 3, 4].map((n) => ({
      id: n,
      integrationId: 5,
      prNumber: 910 + n,
      linkedTaskId: n,
    }));
    const workflowTransitionFindFirst = mock(async () =>
      makeExhaustionRow('sha-x', SEVEN_DAYS_MS + 1000),
    );
    const taskFindUnique = mock(async () => makeTask());
    const updateMany = mock(async () => ({ count: 1 }));
    const taskUpdate = mock(async () => ({}));
    const prisma = {
      gitHubPullRequest: { findMany: mock(async () => candidates), updateMany },
      workflowTransition: { findFirst: workflowTransitionFindFirst },
      task: { findUnique: taskFindUnique, update: taskUpdate },
    } as unknown as PrismaClient;
    const execGh = mock(async (command: string) => {
      if (command.includes('pr view')) {
        return JSON.stringify({
          mergeable: 'CONFLICTING',
          mergeStateStatus: 'DIRTY',
          headRefOid: 'sha-x',
        });
      }
      return '';
    });
    const submitConcernMock = mock(async () => ({
      id: 1,
      outcome: 'created' as const,
      reason: 'new' as const,
      stored: true,
    }));

    const result = await reapStalePrs(prisma, {
      now: () => NOW,
      execGh,
      submitConcern: submitConcernMock,
    });

    expect(result.closedPrNumbers.length).toBe(MAX_REAP_PER_TICK);
    expect(execGh.mock.calls.filter(([c]) => c.includes('pr close')).length).toBe(
      MAX_REAP_PER_TICK,
    );
  });

  it('continues (still files the concern) when the post-close task.update fails', async () => {
    const { prisma, updateMany, taskUpdate } = makePrisma({
      candidates: [{ id: 1, integrationId: 5, prNumber: 906, linkedTaskId: 1 }],
      exhaustionRow: makeExhaustionRow('sha-x', SEVEN_DAYS_MS + 1000),
      task: makeTask(),
      taskUpdateImpl: async () => {
        throw new Error('db write failed');
      },
    });
    const submitConcernMock = mock(async () => ({
      id: 1,
      outcome: 'created' as const,
      reason: 'new' as const,
      stored: true,
    }));
    const execGh = mock(async (command: string) => {
      if (command.includes('pr view')) {
        return JSON.stringify({
          mergeable: 'CONFLICTING',
          mergeStateStatus: 'DIRTY',
          headRefOid: 'sha-x',
        });
      }
      return '';
    });

    const result = await reapStalePrs(prisma, {
      now: () => NOW,
      execGh,
      submitConcern: submitConcernMock,
    });

    expect(result.closedPrNumbers).toEqual([906]);
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(taskUpdate).toHaveBeenCalledTimes(1);
    expect(submitConcernMock).toHaveBeenCalledTimes(1);
  });
});
