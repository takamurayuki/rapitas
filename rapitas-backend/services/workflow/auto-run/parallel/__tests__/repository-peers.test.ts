/**
 * repository-peers.test
 *
 * Task 1552: "same repository" means the same normalized workingDirectory, so
 * a theme split (theme 1 + theme 49) is compared and a different repository
 * is not. Also covers the repository-wide open-PR lookup the overlap guard and
 * selection now use.
 */
import { describe, test, expect, mock } from 'bun:test';
import type { PrismaClient } from '../../../../../generated/prisma-postgres';
import {
  loadRepositoryPeerActiveTasks,
  normalizeWorkingDirectory,
  repositoryThemeIds,
} from '../repository-peers';
import { clearPrFilesCache, getOpenAutoPrsForRepository } from '../../open-pr-files-cache';

const THEMES = [
  { id: 1, workingDirectory: 'C:\\Projects\\rapitas' },
  { id: 49, workingDirectory: 'c:/projects/rapitas/' },
  { id: 50, workingDirectory: 'C:/Projects/other' },
  { id: 60, workingDirectory: null },
];

function prisma(extra: Record<string, unknown> = {}): PrismaClient {
  return {
    theme: {
      findUnique: async (a: { where: { id: number } }) =>
        THEMES.find((t) => t.id === a.where.id) ?? null,
      findMany: async () => THEMES.filter((t) => t.workingDirectory != null),
    },
    ...extra,
  } as unknown as PrismaClient;
}

describe('normalizeWorkingDirectory', () => {
  const rows: Array<[string | null, string | null]> = [
    ['C:\\Projects\\rapitas', 'c:/projects/rapitas'],
    ['c:/projects/rapitas/', 'c:/projects/rapitas'],
    ['  /home/u/repo//  ', '/home/u/repo'],
    ['', null],
    [null, null],
  ];
  for (const [input, expected] of rows) {
    test(`${JSON.stringify(input)} → ${JSON.stringify(expected)}`, () =>
      expect(normalizeWorkingDirectory(input)).toBe(expected));
  }
});

describe('repositoryThemeIds', () => {
  test('theme 1 and theme 49 share the repository; theme 50 does not', async () => {
    expect((await repositoryThemeIds(prisma(), 1)).themeIds.sort((a, b) => a - b)).toEqual([1, 49]);
  });
  test('a theme without a working directory is only itself', async () => {
    expect((await repositoryThemeIds(prisma(), 60)).themeIds).toEqual([60]);
  });
  test('read error → only itself (fail-open)', async () => {
    const broken = { theme: { findUnique: async () => Promise.reject(new Error('db')) } };
    expect((await repositoryThemeIds(broken as unknown as PrismaClient, 1)).themeIds).toEqual([1]);
  });
});

describe('loadRepositoryPeerActiveTasks', () => {
  test('head, companions and queue items of theme 49 only', async () => {
    const p = prisma({
      themeAutoRun: {
        findMany: async (a: { where: { themeId: { in: number[] } } }) =>
          [
            { themeId: 49, currentTaskId: 40, companionTasksJson: '[{"taskId":41,"since":1}]' },
            { themeId: 50, currentTaskId: 50, companionTasksJson: null },
          ].filter((r) => a.where.themeId.in.includes(r.themeId)),
      },
      workflowQueueItem: { findMany: async () => [{ taskId: 42, themeId: 49 }] },
    });
    const peers = await loadRepositoryPeerActiveTasks(p, 1);
    expect(peers.map((x) => x.taskId).sort((a, b) => a - b)).toEqual([40, 41, 42]);
  });
});

describe('getOpenAutoPrsForRepository', () => {
  test('includes open PRs of the other theme on the same repository', async () => {
    clearPrFilesCache();
    const taskFindMany = mock(async () => [{ id: 1531 }, { id: 1552 }]);
    const p = prisma({
      task: { findMany: taskFindMany },
      gitHubPullRequest: {
        findMany: async () => [{ prNumber: 1801, linkedTaskId: 1531, createdAt: null }],
      },
    });
    const prs = await getOpenAutoPrsForRepository(p, 1, undefined, {
      now: () => 1,
      execGh: async () => JSON.stringify({ state: 'OPEN', files: [{ path: 'a.ts' }] }),
    });
    expect(prs.map((x) => x.prNumber)).toEqual([1801]);
    const where = (
      taskFindMany.mock.calls[0] as unknown as [{ where: { themeId: { in: number[] } } }]
    )[0].where;
    expect(where.themeId.in.sort((a, b) => a - b)).toEqual([1, 49]);
  });
});
