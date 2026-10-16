/**
 * blocked-task-evidence テスト
 *
 * blocked タスクの成功証拠照合（受入基準1・3）: linked PR (open/merged) を成功、
 * closed のみ・PR無し・integrationId 解決不能・DB例外を非成功（fail-closed）と
 * 判定することを検証する。さらに task873/948: `cwd` 指定時のライブ再検証
 * （ローカル行の陳腐化をGitHub実状態で覆し自己修復すること）も検証する。
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import type { PrismaClient } from '../../generated/prisma-postgres';

const resolveIntegrationIdForTask = mock(() => Promise.resolve<number | null>(null));
const findScopedOpenPr = mock(() => Promise.resolve<unknown>(null));
mock.module('../../services/github/pr-lookup', () => ({
  resolveIntegrationIdForTask,
  findScopedOpenPr,
}));

const readPrState = mock(() => Promise.resolve<string | null>(null));
mock.module('../../services/workflow/auto-merge-checks', () => ({ readPrState }));

mock.module('../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));

const { resolveBlockedTaskEvidence } =
  await import('../../services/workflow/blocked-task-evidence');

const mockPrisma = {
  gitHubPullRequest: {
    findMany: mock(() => Promise.resolve([] as unknown[])),
    update: mock(() => Promise.resolve({})),
  },
  task: { findUnique: mock(() => Promise.resolve(null as unknown)) },
};
const prisma = mockPrisma as unknown as InstanceType<typeof PrismaClient>;

describe('resolveBlockedTaskEvidence', () => {
  beforeEach(() => {
    mockPrisma.gitHubPullRequest.findMany.mockReset().mockResolvedValue([]);
    mockPrisma.gitHubPullRequest.update.mockReset().mockResolvedValue({});
    mockPrisma.task.findUnique.mockReset().mockResolvedValue(null);
    resolveIntegrationIdForTask.mockReset().mockResolvedValue(null);
    findScopedOpenPr.mockReset().mockResolvedValue(null);
    readPrState.mockReset().mockResolvedValue(null);
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

describe('resolveBlockedTaskEvidence — ライブ再検証 (cwd指定時, task873/948)', () => {
  beforeEach(() => {
    mockPrisma.gitHubPullRequest.findMany.mockReset().mockResolvedValue([]);
    mockPrisma.gitHubPullRequest.update.mockReset().mockResolvedValue({});
    mockPrisma.task.findUnique.mockReset().mockResolvedValue(null);
    resolveIntegrationIdForTask.mockReset().mockResolvedValue(null);
    findScopedOpenPr.mockReset().mockResolvedValue(null);
    readPrState.mockReset().mockResolvedValue(null);
  });

  test('①ローカルは open だが gh 実状態は closed → 非成功へ覆し、行を自己修復する', async () => {
    mockPrisma.gitHubPullRequest.findMany.mockResolvedValue([
      { id: 27149, prNumber: 610, state: 'open' },
    ]);
    readPrState.mockResolvedValue('closed');

    const ev = await resolveBlockedTaskEvidence(prisma, 873, '/repo');

    expect(ev).toEqual({ isSuccess: false, source: 'none', prState: 'closed' });
    expect(readPrState).toHaveBeenCalledWith('/repo', 610);
    expect(mockPrisma.gitHubPullRequest.update).toHaveBeenCalledWith({
      where: { id: 27149 },
      data: { state: 'closed' },
    });
  });

  test('②ローカルは open でgh実状態も open（一致） → 成功のまま、行の更新は呼ばない', async () => {
    mockPrisma.gitHubPullRequest.findMany.mockResolvedValue([
      { id: 458, prNumber: 42, state: 'open' },
    ]);
    readPrState.mockResolvedValue('open');

    const ev = await resolveBlockedTaskEvidence(prisma, 658, '/repo');

    expect(ev).toEqual({ isSuccess: true, source: 'linked_pr', prState: 'open' });
    expect(mockPrisma.gitHubPullRequest.update).not.toHaveBeenCalled();
  });

  test('③ cwd を渡さない（省略） → 従来どおりローカル判定のみ（readPrStateは呼ばれない）', async () => {
    mockPrisma.gitHubPullRequest.findMany.mockResolvedValue([
      { id: 1, prNumber: 1, state: 'open' },
    ]);

    const ev = await resolveBlockedTaskEvidence(prisma, 658);

    expect(ev).toEqual({ isSuccess: true, source: 'linked_pr', prState: 'open' });
    expect(readPrState).not.toHaveBeenCalled();
  });

  test('④ readPrState が null（gh失敗） → ローカル判定をそのまま採用する', async () => {
    mockPrisma.gitHubPullRequest.findMany.mockResolvedValue([
      { id: 458, prNumber: 42, state: 'open' },
    ]);
    readPrState.mockResolvedValue(null);

    const ev = await resolveBlockedTaskEvidence(prisma, 658, '/repo');

    expect(ev).toEqual({ isSuccess: true, source: 'linked_pr', prState: 'open' });
    expect(mockPrisma.gitHubPullRequest.update).not.toHaveBeenCalled();
  });

  test('⑤ scoped_pr（evidence2）経由でもライブ再検証される', async () => {
    mockPrisma.task.findUnique.mockResolvedValue({ githubPrId: 610 });
    resolveIntegrationIdForTask.mockResolvedValue(3);
    findScopedOpenPr.mockResolvedValue({ id: 27149, state: 'open' });
    readPrState.mockResolvedValue('closed');

    const ev = await resolveBlockedTaskEvidence(prisma, 873, '/repo');

    expect(ev).toEqual({ isSuccess: false, source: 'none', prState: 'closed' });
    expect(readPrState).toHaveBeenCalledWith('/repo', 610);
  });
});
