/**
 * blocked-task-evidence テスト
 *
 * blocked タスクの成功証拠照合（受入基準1・3）: linked PR (open/merged) を成功、
 * closed のみ・PR無し・integrationId 解決不能・DB例外を非成功（fail-closed）と
 * 判定することを検証する。
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import type { PrismaClient } from '../../generated/prisma-postgres';

const resolveIntegrationIdForTask = mock(() => Promise.resolve<number | null>(null));
const findScopedOpenPr = mock(() => Promise.resolve<unknown>(null));
mock.module('../../services/github/pr-lookup', () => ({
  resolveIntegrationIdForTask,
  findScopedOpenPr,
}));

const { resolveBlockedTaskEvidence } =
  await import('../../services/workflow/blocked-task-evidence');

const mockPrisma = {
  gitHubPullRequest: { findMany: mock(() => Promise.resolve([] as unknown[])) },
  task: { findUnique: mock(() => Promise.resolve(null as unknown)) },
};
const prisma = mockPrisma as unknown as InstanceType<typeof PrismaClient>;

describe('resolveBlockedTaskEvidence', () => {
  beforeEach(() => {
    mockPrisma.gitHubPullRequest.findMany.mockReset().mockResolvedValue([]);
    mockPrisma.task.findUnique.mockReset().mockResolvedValue(null);
    resolveIntegrationIdForTask.mockReset().mockResolvedValue(null);
    findScopedOpenPr.mockReset().mockResolvedValue(null);
  });

  test('linkedTaskId の open PR がある → 成功 (linked_pr)', async () => {
    mockPrisma.gitHubPullRequest.findMany.mockResolvedValue([{ state: 'open' }]);

    const ev = await resolveBlockedTaskEvidence(prisma, 595);

    expect(ev).toEqual({ isSuccess: true, source: 'linked_pr', prState: 'open' });
  });

  test('linkedTaskId の merged PR がある → 成功 (linked_pr)', async () => {
    mockPrisma.gitHubPullRequest.findMany.mockResolvedValue([{ state: 'merged' }]);

    const ev = await resolveBlockedTaskEvidence(prisma, 578);

    expect(ev.isSuccess).toBe(true);
    expect(ev.source).toBe('linked_pr');
  });

  test('closed PR に後続の open PR が並存 → open 側で成功', async () => {
    mockPrisma.gitHubPullRequest.findMany.mockResolvedValue([
      { state: 'open' },
      { state: 'closed' },
    ]);

    const ev = await resolveBlockedTaskEvidence(prisma, 596);

    expect(ev.isSuccess).toBe(true);
  });

  test('closed(unmerged) PR のみ → 非成功（負の証拠、done 是正しない）', async () => {
    mockPrisma.gitHubPullRequest.findMany.mockResolvedValue([{ state: 'closed' }]);
    // githubPrId フォールバックも open を見つけない
    mockPrisma.task.findUnique.mockResolvedValue({ githubPrId: 7 });
    resolveIntegrationIdForTask.mockResolvedValue(1);
    findScopedOpenPr.mockResolvedValue(null);

    const ev = await resolveBlockedTaskEvidence(prisma, 600);

    expect(ev.isSuccess).toBe(false);
    expect(ev.prState).toBe('closed');
  });

  test('linked 無し + githubPrId + integrationId 解決 + scoped open 行あり → 成功 (scoped_pr)', async () => {
    mockPrisma.task.findUnique.mockResolvedValue({ githubPrId: 376 });
    resolveIntegrationIdForTask.mockResolvedValue(3);
    findScopedOpenPr.mockResolvedValue({ id: 10, state: 'open' });

    const ev = await resolveBlockedTaskEvidence(prisma, 578);

    expect(ev).toEqual({ isSuccess: true, source: 'scoped_pr', prState: 'open' });
    const call = findScopedOpenPr.mock.calls[0] as unknown[];
    expect(call[1]).toBe(3); // integrationId スコープ付きで照会していること
    expect(call[2]).toBe(376);
  });

  test('integrationId 解決不能 → fail-closed（scoped 照会せず非成功）', async () => {
    mockPrisma.task.findUnique.mockResolvedValue({ githubPrId: 376 });
    resolveIntegrationIdForTask.mockResolvedValue(null);

    const ev = await resolveBlockedTaskEvidence(prisma, 578);

    expect(ev.isSuccess).toBe(false);
    expect(findScopedOpenPr).not.toHaveBeenCalled();
  });

  test('PR 証拠が一切ない → 非成功（completedAt 等の傍証だけでは是正しない）', async () => {
    mockPrisma.task.findUnique.mockResolvedValue({ githubPrId: null });

    const ev = await resolveBlockedTaskEvidence(prisma, 601);

    expect(ev).toEqual({ isSuccess: false, source: 'none' });
  });

  test('DB 例外時は非成功（fail-closed）', async () => {
    mockPrisma.gitHubPullRequest.findMany.mockRejectedValue(new Error('db down'));
    mockPrisma.task.findUnique.mockRejectedValue(new Error('db down'));

    const ev = await resolveBlockedTaskEvidence(prisma, 1);

    expect(ev.isSuccess).toBe(false);
  });
});
