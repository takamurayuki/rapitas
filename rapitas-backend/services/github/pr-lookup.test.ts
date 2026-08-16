/**
 * pr-lookup.test
 *
 * findScopedOpenPr: the composite (integrationId, prNumber, state:'open')
 * lookup returns only the target repo's row when two repos share a prNumber
 * (task #596 acceptance criterion 1). resolveIntegrationIdForTask: repo
 * identity resolution from a task's theme URL, incl. the fail-closed null.
 * resolveIntegrationId runs for REAL against the stub prisma (its URL parsing
 * is pure; fixtures always set a parseable repositoryUrl so the git-remote
 * subprocess fallback is never reached).
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test';

// NOTE: pr-link imports auto-merge-notify → config/database; stub both so this
// unit test never touches a real Prisma client (mock.module is process-global,
// so mirror every export the barrels re-export).
mock.module('../../config/database', () => ({
  prisma: {},
  ensureDatabaseConnection: mock(() => Promise.resolve()),
}));
mock.module('../../config/logger', () => {
  const noop = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
  return {
    createLogger: () => noop,
    logger: noop,
    getBackendLogFilePath: () => '/tmp/backend.log',
  };
});

const { findScopedOpenPr, resolveIntegrationIdForTask } = await import('./pr-lookup');

interface PrRow {
  id: number;
  integrationId: number;
  prNumber: number;
  state: string;
  baseBranch: string | null;
}

let prRows: PrRow[] = [];
let integrations: { id: number; ownerName: string; repositoryName: string }[] = [];
let taskRow: {
  workingDirectory: string | null;
  theme: { repositoryUrl: string | null; workingDirectory: string | null } | null;
} | null = null;

/** Stub honoring the exact where/select shapes the module under test issues. */
const prismaStub = {
  gitHubPullRequest: {
    findFirst: (args: {
      where: { integrationId: number; prNumber: number; state: string };
      select: Record<string, boolean>;
    }) => {
      const row = prRows.find(
        (r) =>
          r.integrationId === args.where.integrationId &&
          r.prNumber === args.where.prNumber &&
          r.state === args.where.state,
      );
      if (!row) return Promise.resolve(null);
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(args.select)) out[key] = row[key as keyof PrRow];
      return Promise.resolve(out);
    },
  },
  gitHubIntegration: {
    findMany: () => Promise.resolve(integrations),
  },
  task: {
    findUnique: () => Promise.resolve(taskRow),
  },
};
type PrismaParam = Parameters<typeof findScopedOpenPr>[0];
const prisma = prismaStub as unknown as PrismaParam;

beforeEach(() => {
  prRows = [];
  integrations = [];
  taskRow = null;
});

describe('findScopedOpenPr — cross-repo prNumber collision', () => {
  it('returns only the target repository\'s row when two repos share a prNumber', async () => {
    prRows = [
      { id: 99, integrationId: 2, prNumber: 6, state: 'open', baseBranch: 'conv-base' },
      { id: 21, integrationId: 1, prNumber: 6, state: 'open', baseBranch: 'tripla-base' },
    ];

    const hit = await findScopedOpenPr(prisma, 1, 6, { id: true, baseBranch: true });

    expect(hit).toEqual({ id: 21, baseBranch: 'tripla-base' });
  });

  it('returns null when only ANOTHER repo has an open row for that number', async () => {
    prRows = [{ id: 99, integrationId: 2, prNumber: 7, state: 'open', baseBranch: 'conv' }];

    expect(await findScopedOpenPr(prisma, 1, 7, { id: true })).toBeNull();
  });

  it('returns null when the own repo\'s same-numbered row is not open', async () => {
    prRows = [
      { id: 5, integrationId: 1, prNumber: 7, state: 'merged', baseBranch: 'develop' },
      { id: 99, integrationId: 2, prNumber: 7, state: 'open', baseBranch: 'conv' },
    ];

    expect(await findScopedOpenPr(prisma, 1, 7, { id: true })).toBeNull();
  });
});

describe('resolveIntegrationIdForTask', () => {
  it('resolves via the theme repositoryUrl to the matching integration', async () => {
    integrations = [
      { id: 1, ownerName: 'takamurayuki', repositoryName: 'tripla' },
      { id: 2, ownerName: 'takamurayuki', repositoryName: 'ime-live-converter' },
    ];
    taskRow = {
      workingDirectory: null,
      theme: { repositoryUrl: 'https://github.com/takamurayuki/tripla', workingDirectory: null },
    };

    expect(await resolveIntegrationIdForTask(prisma, 491)).toBe(1);
  });

  it('returns null (fail-closed) for an unmatchable URL when several integrations exist', async () => {
    integrations = [
      { id: 1, ownerName: 'takamurayuki', repositoryName: 'tripla' },
      { id: 2, ownerName: 'takamurayuki', repositoryName: 'ime-live-converter' },
    ];
    taskRow = {
      workingDirectory: null,
      theme: { repositoryUrl: 'https://github.com/other/elsewhere', workingDirectory: null },
    };

    expect(await resolveIntegrationIdForTask(prisma, 1)).toBeNull();
  });

  it('returns null when the task does not exist', async () => {
    taskRow = null;

    expect(await resolveIntegrationIdForTask(prisma, 999)).toBeNull();
  });
});
