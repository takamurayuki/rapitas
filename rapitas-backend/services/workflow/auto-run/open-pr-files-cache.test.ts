/**
 * open-pr-files-cache.test.ts
 *
 * Unit tests for the TTL-cached PR changed-files fetcher and the theme-scoped
 * open auto-PR query (task 573, requirement B). gh and Prisma are stubbed.
 */
import { describe, it, expect, beforeEach, mock } from 'bun:test';
import {
  PR_FILES_CACHE_TTL_MS,
  clearPrFilesCache,
  getOpenAutoPrsForTheme,
  getPrChangedFiles,
  type PrFilesDeps,
} from './open-pr-files-cache';
import type { PrismaClient } from '../../../generated/prisma-postgres';

function ghDeps(stdout: string | Error, nowRef: { t: number }): PrFilesDeps & { calls: number[] } {
  const calls: number[] = [];
  return {
    calls,
    execGh: async (command) => {
      calls.push(1);
      if (stdout instanceof Error) throw stdout;
      // Sanity: the command must target `pr view <n> --json files`.
      expect(command).toContain('pr view');
      expect(command).toContain('--json files');
      return stdout;
    },
    now: () => nowRef.t,
  };
}

describe('getPrChangedFiles (TTL cache)', () => {
  beforeEach(() => clearPrFilesCache());

  const PAYLOAD = JSON.stringify({
    files: [{ path: 'services/a.ts' }, { path: 'routes/b.ts' }, { path: '' }],
  });

  it('parses .files[].path and drops empty paths', async () => {
    const nowRef = { t: 1000 };
    const deps = ghDeps(PAYLOAD, nowRef);
    const files = await getPrChangedFiles('/repo', 358, deps);
    expect(files).toEqual(['services/a.ts', 'routes/b.ts']);
  });

  it('serves a second call within the TTL from cache (no extra gh call)', async () => {
    const nowRef = { t: 1000 };
    const deps = ghDeps(PAYLOAD, nowRef);
    await getPrChangedFiles('/repo', 358, deps);
    nowRef.t += PR_FILES_CACHE_TTL_MS - 1;
    const files = await getPrChangedFiles('/repo', 358, deps);
    expect(files).toEqual(['services/a.ts', 'routes/b.ts']);
    expect(deps.calls.length).toBe(1);
  });

  it('re-fetches after the TTL expires', async () => {
    const nowRef = { t: 1000 };
    const deps = ghDeps(PAYLOAD, nowRef);
    await getPrChangedFiles('/repo', 358, deps);
    nowRef.t += PR_FILES_CACHE_TTL_MS;
    await getPrChangedFiles('/repo', 358, deps);
    expect(deps.calls.length).toBe(2);
  });

  it('caches per PR number independently', async () => {
    const nowRef = { t: 1000 };
    const deps = ghDeps(PAYLOAD, nowRef);
    await getPrChangedFiles('/repo', 358, deps);
    await getPrChangedFiles('/repo', 363, deps);
    expect(deps.calls.length).toBe(2);
  });

  it('gh error → empty list (fail-open), cached for the TTL', async () => {
    const nowRef = { t: 1000 };
    const deps = ghDeps(new Error('gh exploded'), nowRef);
    expect(await getPrChangedFiles('/repo', 999, deps)).toEqual([]);
    // Failure is memoized: no immediate hammering of gh.
    expect(await getPrChangedFiles('/repo', 999, deps)).toEqual([]);
    expect(deps.calls.length).toBe(1);
  });

  it('unparseable gh output → empty list (fail-open)', async () => {
    const nowRef = { t: 1000 };
    const deps = ghDeps('not json at all', nowRef);
    expect(await getPrChangedFiles('/repo', 111, deps)).toEqual([]);
  });

  it.each(['CLOSED', 'MERGED'])('ignores files for a remotely %s PR', async (state) => {
    const deps = ghDeps(JSON.stringify({ state, files: [{ path: 'still/listed.ts' }] }), { t: 1 });
    expect(await getPrChangedFiles('/repo', 619, deps)).toEqual([]);
  });

  it('does not share same-number PR snapshots across repositories', async () => {
    const nowRef = { t: 1000 };
    await getPrChangedFiles('/one', 1, ghDeps(JSON.stringify({ state: 'CLOSED' }), nowRef));
    expect(await getPrChangedFiles('/two', 1, ghDeps(PAYLOAD, nowRef))).toEqual([
      'services/a.ts',
      'routes/b.ts',
    ]);
  });

  it('rechecks state at TTL expiry after an open PR merges', async () => {
    const nowRef = { t: 1000 };
    expect(await getPrChangedFiles('/repo', 1, ghDeps(PAYLOAD, nowRef))).toHaveLength(2);
    nowRef.t += PR_FILES_CACHE_TTL_MS;
    expect(
      await getPrChangedFiles(
        '/repo',
        1,
        ghDeps(JSON.stringify({ state: 'MERGED', files: [{ path: 'services/a.ts' }] }), nowRef),
      ),
    ).toEqual([]);
  });
});

describe('getOpenAutoPrsForTheme', () => {
  beforeEach(() => clearPrFilesCache());
  it("queries state='open' PRs linked to the theme's task ids", async () => {
    const findManyPr = mock().mockResolvedValue([
      { prNumber: 358, linkedTaskId: 559 },
      { prNumber: 363, linkedTaskId: 563 },
    ]);
    const prisma = {
      task: { findMany: mock().mockResolvedValue([{ id: 559 }, { id: 563 }]) },
      gitHubPullRequest: { findMany: findManyPr },
      theme: { findUnique: mock().mockResolvedValue(null) },
    } as unknown as PrismaClient;
    const prs = await getOpenAutoPrsForTheme(prisma, 7);
    expect(prs.map((p) => p.prNumber)).toEqual([358, 363]);
    expect(findManyPr).toHaveBeenCalledWith({
      where: { state: 'open', linkedTaskId: { in: [559, 563] } },
      select: { prNumber: true, linkedTaskId: true, createdAt: true },
    });
  });

  it('removes confirmed closed/merged candidates and reuses files for scope checks', async () => {
    const rows = [1, 2, 3, 4].map((prNumber) => ({ prNumber, linkedTaskId: 559, createdAt: null }));
    const prisma = {
      task: { findMany: mock().mockResolvedValue([{ id: 559 }]) },
      gitHubPullRequest: { findMany: mock().mockResolvedValue(rows) },
      theme: { findUnique: mock().mockResolvedValue({ workingDirectory: '/repo' }) },
    } as unknown as PrismaClient;
    let calls = 0;
    const deps: PrFilesDeps = {
      now: () => 1,
      execGh: async (command) => {
        calls++;
        const number = Number(command.match(/pr view (\d+)/)?.[1]);
        if (number === 4) throw Error('network unavailable');
        return JSON.stringify({
          state: ['OPEN', 'CLOSED', 'MERGED'][number - 1],
          files: [{ path: 'active.ts' }],
        });
      },
    };
    expect((await getOpenAutoPrsForTheme(prisma, 7, deps)).map((pr) => pr.prNumber)).toEqual([
      1, 4,
    ]);
    expect(await getPrChangedFiles('/repo', 1, deps)).toEqual(['active.ts']);
    expect(await getPrChangedFiles('/repo', 2, deps)).toEqual([]);
    expect(calls).toBe(4);
  });

  it('theme without tasks → [] without querying PRs', async () => {
    const findManyPr = mock();
    const prisma = {
      task: { findMany: mock().mockResolvedValue([]) },
      gitHubPullRequest: { findMany: findManyPr },
    } as unknown as PrismaClient;
    expect(await getOpenAutoPrsForTheme(prisma, 7)).toEqual([]);
    expect(findManyPr).not.toHaveBeenCalled();
  });

  it('DB error → [] (fail-open: selection must not stop)', async () => {
    const prisma = {
      task: { findMany: mock().mockRejectedValue(new Error('db down')) },
      gitHubPullRequest: { findMany: mock() },
    } as unknown as PrismaClient;
    expect(await getOpenAutoPrsForTheme(prisma, 7)).toEqual([]);
  });

  it('excludes an exhausted PR whose head SHA matches the recorded park-time SHA', async () => {
    const rows = [{ prNumber: 1, linkedTaskId: 559, createdAt: null }];
    const prisma = {
      task: { findMany: mock().mockResolvedValue([{ id: 559 }]) },
      gitHubPullRequest: { findMany: mock().mockResolvedValue(rows) },
      theme: { findUnique: mock().mockResolvedValue({ workingDirectory: '/repo' }) },
      workflowTransition: {
        findFirst: mock().mockResolvedValue({
          cause: 'auto_merge_exhausted',
          metadata: JSON.stringify({ headSha: 'sha-parked' }),
          createdAt: new Date('2026-09-01T00:00:00Z'),
        }),
      },
    } as unknown as PrismaClient;
    const deps: PrFilesDeps = {
      now: () => 1,
      execGh: async () => JSON.stringify({ state: 'OPEN', files: [], headRefOid: 'sha-parked' }),
    };
    expect(await getOpenAutoPrsForTheme(prisma, 7, deps)).toEqual([]);
  });

  it('keeps an exhausted PR whose current head SHA differs from the park-time SHA (live retry)', async () => {
    const rows = [{ prNumber: 1, linkedTaskId: 559, createdAt: null }];
    const prisma = {
      task: { findMany: mock().mockResolvedValue([{ id: 559 }]) },
      gitHubPullRequest: { findMany: mock().mockResolvedValue(rows) },
      theme: { findUnique: mock().mockResolvedValue({ workingDirectory: '/repo' }) },
      workflowTransition: {
        findFirst: mock().mockResolvedValue({
          cause: 'auto_merge_exhausted',
          metadata: JSON.stringify({ headSha: 'sha-parked' }),
          createdAt: new Date('2026-09-01T00:00:00Z'),
        }),
      },
    } as unknown as PrismaClient;
    const deps: PrFilesDeps = {
      now: () => 1,
      execGh: async () => JSON.stringify({ state: 'OPEN', files: [], headRefOid: 'sha-new-push' }),
    };
    expect((await getOpenAutoPrsForTheme(prisma, 7, deps)).map((p) => p.prNumber)).toEqual([1]);
  });

  it('keeps a PR with no exhaustion mark', async () => {
    const rows = [{ prNumber: 1, linkedTaskId: 559, createdAt: null }];
    const prisma = {
      task: { findMany: mock().mockResolvedValue([{ id: 559 }]) },
      gitHubPullRequest: { findMany: mock().mockResolvedValue(rows) },
      theme: { findUnique: mock().mockResolvedValue({ workingDirectory: '/repo' }) },
      workflowTransition: { findFirst: mock().mockResolvedValue(null) },
    } as unknown as PrismaClient;
    const deps: PrFilesDeps = {
      now: () => 1,
      execGh: async () => JSON.stringify({ state: 'OPEN', files: [], headRefOid: 'sha-x' }),
    };
    expect((await getOpenAutoPrsForTheme(prisma, 7, deps)).map((p) => p.prNumber)).toEqual([1]);
  });

  it('drops an exhausted+head-matched PR alongside a separately CLOSED PR, keeping the rest', async () => {
    const rows = [
      { prNumber: 1, linkedTaskId: 559, createdAt: null }, // exhausted + head match → excluded
      { prNumber: 2, linkedTaskId: 560, createdAt: null }, // CLOSED → excluded (existing filter)
      { prNumber: 3, linkedTaskId: 561, createdAt: null }, // normal open → kept
    ];
    const prisma = {
      task: { findMany: mock().mockResolvedValue([{ id: 559 }, { id: 560 }, { id: 561 }]) },
      gitHubPullRequest: { findMany: mock().mockResolvedValue(rows) },
      theme: { findUnique: mock().mockResolvedValue({ workingDirectory: '/repo' }) },
      workflowTransition: {
        findFirst: mock(async ({ where }: { where: { taskId: number } }) => {
          if (where.taskId === 559) {
            return {
              cause: 'auto_merge_exhausted',
              metadata: JSON.stringify({ headSha: 'sha-parked' }),
              createdAt: new Date('2026-09-01T00:00:00Z'),
            };
          }
          return null;
        }),
      },
    } as unknown as PrismaClient;
    const deps: PrFilesDeps = {
      now: () => 1,
      execGh: async (command) => {
        const number = Number(command.match(/pr view (\d+)/)?.[1]);
        if (number === 1) return JSON.stringify({ state: 'OPEN', headRefOid: 'sha-parked' });
        if (number === 2) return JSON.stringify({ state: 'CLOSED', headRefOid: 'sha-closed' });
        return JSON.stringify({ state: 'OPEN', headRefOid: 'sha-open' });
      },
    };
    expect((await getOpenAutoPrsForTheme(prisma, 7, deps)).map((p) => p.prNumber)).toEqual([3]);
  });

  it('caps parallel gh calls instead of firing one per open PR (2026-09-18/19 incident: 57 open PRs fired 57 simultaneous `gh` processes on one cache refresh)', async () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({
      prNumber: i + 1,
      linkedTaskId: 559,
      createdAt: null,
    }));
    const prisma = {
      task: { findMany: mock().mockResolvedValue([{ id: 559 }]) },
      gitHubPullRequest: { findMany: mock().mockResolvedValue(rows) },
      theme: { findUnique: mock().mockResolvedValue({ workingDirectory: '/repo' }) },
    } as unknown as PrismaClient;

    let inFlight = 0;
    let maxInFlight = 0;
    const deps: PrFilesDeps = {
      now: () => 1,
      execGh: async () => {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight--;
        return JSON.stringify({ state: 'OPEN', files: [] });
      },
    };

    await getOpenAutoPrsForTheme(prisma, 7, deps);
    // Default cap (RAPITAS_PR_FILES_CACHE_CONCURRENCY unset → 4): far below
    // the 20 PRs queried, proving they were NOT all fired at once.
    expect(maxInFlight).toBeLessThanOrEqual(4);
    expect(maxInFlight).toBeGreaterThan(1); // still runs some in parallel, not fully serial
  });
});
