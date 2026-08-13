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
});

describe('getOpenAutoPrsForTheme', () => {
  it("queries state='open' PRs linked to the theme's task ids", async () => {
    const findManyPr = mock().mockResolvedValue([
      { prNumber: 358, linkedTaskId: 559 },
      { prNumber: 363, linkedTaskId: 563 },
    ]);
    const prisma = {
      task: { findMany: mock().mockResolvedValue([{ id: 559 }, { id: 563 }]) },
      gitHubPullRequest: { findMany: findManyPr },
    } as unknown as PrismaClient;
    const prs = await getOpenAutoPrsForTheme(prisma, 7);
    expect(prs.map((p) => p.prNumber)).toEqual([358, 363]);
    expect(findManyPr).toHaveBeenCalledWith({
      where: { state: 'open', linkedTaskId: { in: [559, 563] } },
      select: { prNumber: true, linkedTaskId: true },
    });
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
});
