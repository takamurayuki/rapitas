/**
 * pr-link テスト
 *
 * linkAutoCreatedPr: 自動生成PRをローカルDBへ永続化しタスクへ紐付ける処理の
 * ユニットテスト。統合の解決・upsert・Task.githubPrId 更新・失敗時の握り潰しを検証。
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import { linkAutoCreatedPr } from '../../services/github/pr-link';

type AnyMock = ReturnType<typeof mock>;

function makePrisma(overrides?: {
  integrations?: Array<{ id: number; ownerName: string; repositoryName: string }>;
  upsertId?: number;
  upsertThrows?: boolean;
}) {
  const integrations = overrides?.integrations ?? [
    { id: 7, ownerName: 'takamurayuki', repositoryName: 'rapitas' },
  ];
  const upsert: AnyMock = overrides?.upsertThrows
    ? mock(() => Promise.reject(new Error('db down')))
    : mock(() => Promise.resolve({ id: overrides?.upsertId ?? 42 }));
  const taskUpdate: AnyMock = mock(() => Promise.resolve({}));
  return {
    prisma: {
      gitHubIntegration: {
        findMany: mock(() => Promise.resolve(integrations)),
        findUnique: mock(() =>
          Promise.resolve(integrations[0] ? { ownerName: integrations[0].ownerName } : null),
        ),
      },
      gitHubPullRequest: { upsert },
      task: { update: taskUpdate },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
    upsert,
    taskUpdate,
  };
}

const baseParams = {
  taskId: 99,
  prNumber: 5,
  prUrl: 'https://github.com/takamurayuki/rapitas/pull/5',
  title: '[Task-99] fix the thing',
  headBranch: 'feature/99-fix',
  baseBranch: 'develop',
  repositoryUrl: 'https://github.com/takamurayuki/rapitas.git',
};

describe('linkAutoCreatedPr', () => {
  beforeEach(() => {
    /* fresh mocks per test via makePrisma */
  });

  test('links PR by owner/repo match and sets Task.githubPrId', async () => {
    const { prisma, upsert, taskUpdate } = makePrisma();
    const id = await linkAutoCreatedPr(prisma, baseParams);

    expect(id).toBe(42);
    expect(upsert).toHaveBeenCalledTimes(1);
    const upsertArg = upsert.mock.calls[0][0] as {
      where: { integrationId_prNumber: { integrationId: number; prNumber: number } };
      create: { linkedTaskId: number; integrationId: number };
    };
    expect(upsertArg.where.integrationId_prNumber).toEqual({ integrationId: 7, prNumber: 5 });
    expect(upsertArg.create.linkedTaskId).toBe(99);
    expect(taskUpdate).toHaveBeenCalledTimes(1);
    const taskArg = taskUpdate.mock.calls[0][0] as { data: { githubPrId: number } };
    expect(taskArg.data.githubPrId).toBe(5);
  });

  test('returns null and does not upsert when no integrations exist', async () => {
    const { prisma, upsert } = makePrisma({ integrations: [] });
    const id = await linkAutoCreatedPr(prisma, baseParams);
    expect(id).toBeNull();
    expect(upsert).not.toHaveBeenCalled();
  });

  test('falls back to the sole integration when owner/repo does not match', async () => {
    const { prisma, upsert } = makePrisma({
      integrations: [{ id: 3, ownerName: 'someone', repositoryName: 'else' }],
    });
    const id = await linkAutoCreatedPr(prisma, baseParams);
    expect(id).toBe(42);
    const upsertArg = upsert.mock.calls[0][0] as {
      where: { integrationId_prNumber: { integrationId: number } };
    };
    expect(upsertArg.where.integrationId_prNumber.integrationId).toBe(3);
  });

  test('returns null when multiple integrations and none match', async () => {
    const { prisma, upsert } = makePrisma({
      integrations: [
        { id: 1, ownerName: 'a', repositoryName: 'x' },
        { id: 2, ownerName: 'b', repositoryName: 'y' },
      ],
    });
    const id = await linkAutoCreatedPr(prisma, { ...baseParams, repositoryUrl: null });
    expect(id).toBeNull();
    expect(upsert).not.toHaveBeenCalled();
  });

  test('swallows persistence errors and returns null', async () => {
    const { prisma } = makePrisma({ upsertThrows: true });
    const id = await linkAutoCreatedPr(prisma, baseParams);
    expect(id).toBeNull();
  });
});
