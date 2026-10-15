/**
 * manual-pr-link tests
 *
 * Covers the operator "register a hand-made PR" service: acceptance on the happy
 * path (both lookup routes of findLandedPullRequest are fed) and the three
 * rejections — missing PR, other repository, PR linked to another task.
 */
import { describe, test, expect } from 'bun:test';
import { registerManualPr } from '../../../services/github/manual-pr-link';
import type { FetchedPr } from '../../../services/github/manual-pr-link';

const OPEN_PR: FetchedPr = {
  number: 915,
  title: 'Resolve conflicts for develop',
  body: '',
  state: 'OPEN',
  headBranch: 'feature/x',
  baseBranch: 'develop',
  authorLogin: 'op',
  url: 'https://github.com/acme/app/pull/915',
};

function makeDb(opts: { existing?: { linkedTaskId: number | null } | null } = {}) {
  const calls = { upsert: [] as unknown[], updateMany: [] as unknown[] };
  const updatedAt = new Date('2026-10-15T00:00:00Z');
  const db = {
    task: {
      findUnique: async (args: { select: Record<string, unknown> }) =>
        args.select.theme
          ? {
              workingDirectory: null,
              theme: { repositoryUrl: 'https://github.com/acme/app', workingDirectory: null },
            }
          : { id: 1269, updatedAt },
      updateMany: async (args: unknown) => {
        calls.updateMany.push(args);
        return { count: 1 };
      },
    },
    gitHubIntegration: {
      findMany: async () => [
        { id: 1, ownerName: 'acme', repositoryName: 'app' },
        { id: 2, ownerName: 'acme', repositoryName: 'other' },
      ],
    },
    gitHubPullRequest: {
      findUnique: async () => opts.existing ?? null,
      upsert: async (args: unknown) => {
        calls.upsert.push(args);
        return { id: 77 };
      },
    },
  };
  return { db: db as never, calls };
}

const params = { taskId: 1269, prNumber: 915, repo: 'acme/app' };

describe('registerManualPr', () => {
  test('登録し linkedTaskId と Task.githubPrId の両経路を設定すること', async () => {
    const { db, calls } = makeDb();
    const res = await registerManualPr(db, async () => OPEN_PR, params);

    expect(res).toEqual({ ok: true, localPrId: 77, prNumber: 915, state: 'open' });
    const upsert = calls.upsert[0] as { create: Record<string, unknown> };
    expect(upsert.create.linkedTaskId).toBe(1269);
    expect(upsert.create.integrationId).toBe(1);
    expect((calls.updateMany[0] as { data: { githubPrId: number } }).data.githubPrId).toBe(915);
  });

  test('存在しない PR 番号を 404 で拒否すること', async () => {
    const { db, calls } = makeDb();
    const res = await registerManualPr(db, async () => null, params);
    expect(res).toMatchObject({ ok: false, status: 404, reason: 'pr_not_found' });
    expect(calls.upsert).toHaveLength(0);
  });

  test('タスクのリポジトリと異なる repo を 409 で拒否すること', async () => {
    const { db, calls } = makeDb();
    const res = await registerManualPr(db, async () => OPEN_PR, { ...params, repo: 'acme/other' });
    expect(res).toMatchObject({ ok: false, status: 409, reason: 'repo_mismatch' });
    expect(calls.upsert).toHaveLength(0);
  });

  test('未登録リポジトリを統合の暗黙作成なしで拒否すること', async () => {
    const { db } = makeDb();
    const res = await registerManualPr(db, async () => OPEN_PR, { ...params, repo: 'evil/app' });
    expect(res).toMatchObject({ ok: false, status: 404, reason: 'integration_not_found' });
  });

  test('他タスクに紐付け済みの PR を 409 で拒否すること', async () => {
    const { db, calls } = makeDb({ existing: { linkedTaskId: 999 } });
    const res = await registerManualPr(db, async () => OPEN_PR, params);
    expect(res).toMatchObject({ ok: false, status: 409, reason: 'linked_to_other_task' });
    expect(calls.upsert).toHaveLength(0);
  });

  test('マーカーが別タスクを指す PR を拒否すること', async () => {
    const { db } = makeDb();
    const res = await registerManualPr(
      db,
      async () => ({ ...OPEN_PR, title: '[#1174] fix' }),
      params,
    );
    expect(res).toMatchObject({ ok: false, reason: 'marker_mismatch' });
  });

  test('未マージで閉じられた PR を拒否すること', async () => {
    const { db } = makeDb();
    const res = await registerManualPr(db, async () => ({ ...OPEN_PR, state: 'CLOSED' }), params);
    expect(res).toMatchObject({ ok: false, reason: 'pr_closed' });
  });
});
