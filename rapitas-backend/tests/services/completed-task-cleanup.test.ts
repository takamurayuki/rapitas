/**
 * completed-task-cleanup テスト
 *
 * 完了タスクの剪定: 直近N件を残し古い完了タスクを削除。削除前にナレッジ未記録なら
 * 抽出して記録、記録済みなら削除のみ。dryRun は件数集計のみ。未完サブタスクを持つ
 * 親はスキップ。
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

// HACK(agent): Bun mock型推論の制限 — `as any` で型チェックをバイパス
const taskFindMany = mock(() => Promise.resolve([] as Array<{ id: number }>)) as any;
const taskCount = mock(() => Promise.resolve(0)) as any;
const taskDelete = mock(() => Promise.resolve({})) as any;
const taskFindUnique = mock(() => Promise.resolve({ workingDirectory: null })) as any;
const knowledgeCount = mock(() => Promise.resolve(0)) as any;
const sessionFindMany = mock(() => Promise.resolve([])) as any;
const sessionUpdate = mock(() => Promise.resolve({})) as any;

const mockPrisma = {
  task: {
    findMany: taskFindMany,
    count: taskCount,
    delete: taskDelete,
    findUnique: taskFindUnique,
  },
  knowledgeEntry: { count: knowledgeCount },
  agentSession: { findMany: sessionFindMany, update: sessionUpdate },
};

mock.module('../../config/database', () => ({
  prisma: mockPrisma,
  ensureDatabaseConnection: () => Promise.resolve(),
}));
mock.module('../../config', () => ({
  prisma: mockPrisma,
  getProjectRoot: () => '/repo',
}));
mock.module('../../config/logger', () => {
  const noop = { info: () => {}, error: () => {}, warn: () => {}, debug: () => {} };
  return { createLogger: () => noop, logger: noop, getBackendLogFilePath: () => '/tmp/b.log' };
});

const removeWorktree = mock(() => Promise.resolve()) as any;
mock.module('../../services/agents/orchestrator/git-operations/worktree/worktree-ops', () => ({
  removeWorktree,
}));
const extractKnowledgeFromTask = mock(() => Promise.resolve([101])) as any;
mock.module('../../services/memory/task-knowledge-extractor', () => ({ extractKnowledgeFromTask }));

const { cleanupCompletedTasks } = await import('../../services/task/completed-task-cleanup');

beforeEach(() => {
  for (const m of [
    taskFindMany,
    taskCount,
    taskDelete,
    taskFindUnique,
    knowledgeCount,
    sessionFindMany,
    sessionUpdate,
    removeWorktree,
    extractKnowledgeFromTask,
  ]) {
    m.mockReset();
  }
  taskCount.mockResolvedValue(0); // no open subtasks
  taskDelete.mockResolvedValue({});
  taskFindUnique.mockResolvedValue({ workingDirectory: null });
  sessionFindMany.mockResolvedValue([]);
  extractKnowledgeFromTask.mockResolvedValue([101]);
});

describe('cleanupCompletedTasks', () => {
  test('直近N件を残して古い完了タスクのみ削除すること', async () => {
    // 5 completed (newest first); keepRecent=2 → candidates = ids 3,4,5
    taskFindMany.mockResolvedValueOnce([{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }]);
    knowledgeCount.mockResolvedValue(1); // all already recorded

    const r = await cleanupCompletedTasks({ keepRecent: 2 });

    expect(r.completedTotal).toBe(5);
    expect(r.candidateCount).toBe(3);
    expect(r.deletedCount).toBe(3);
    expect(r.deletedTaskIds).toEqual([3, 4, 5]);
    expect(taskDelete).toHaveBeenCalledTimes(3);
    // 記録済みなので抽出は呼ばれない
    expect(extractKnowledgeFromTask).not.toHaveBeenCalled();
  });

  test('ナレッジ未記録なら抽出してから削除すること', async () => {
    taskFindMany.mockResolvedValueOnce([{ id: 10 }]);
    knowledgeCount.mockResolvedValue(0); // not recorded yet

    const r = await cleanupCompletedTasks({ keepRecent: 0 });

    expect(extractKnowledgeFromTask).toHaveBeenCalledWith(10);
    expect(r.knowledgeRecorded).toBe(1);
    expect(r.alreadyRecorded).toBe(0);
    expect(taskDelete).toHaveBeenCalledTimes(1);
  });

  test('dryRun は削除・抽出をせず件数のみ返すこと', async () => {
    taskFindMany.mockResolvedValueOnce([{ id: 7 }, { id: 8 }]);
    knowledgeCount.mockResolvedValue(0);

    const r = await cleanupCompletedTasks({ keepRecent: 0, dryRun: true });

    expect(r.dryRun).toBe(true);
    expect(r.candidateCount).toBe(2);
    expect(r.deletedCount).toBe(2); // would-delete count
    expect(taskDelete).not.toHaveBeenCalled();
    expect(extractKnowledgeFromTask).not.toHaveBeenCalled();
  });

  test('themeId 指定時はそのテーマに絞って取得すること', async () => {
    taskFindMany.mockResolvedValueOnce([{ id: 30 }]);
    knowledgeCount.mockResolvedValue(1);

    const r = await cleanupCompletedTasks({ keepRecent: 0, themeId: 7 });

    expect(r.themeId).toBe(7);
    const whereArg = (taskFindMany.mock.calls[0][0] as { where: { themeId?: number } }).where;
    expect(whereArg.themeId).toBe(7);
  });

  test('themeId 未指定なら全テーマ（where に themeId を含めない）', async () => {
    taskFindMany.mockResolvedValueOnce([{ id: 40 }]);
    knowledgeCount.mockResolvedValue(1);

    const r = await cleanupCompletedTasks({ keepRecent: 0 });

    expect(r.themeId).toBeNull();
    const whereArg = (taskFindMany.mock.calls[0][0] as { where: Record<string, unknown> }).where;
    expect('themeId' in whereArg).toBe(false);
  });

  test('未完サブタスクを持つ親はスキップすること', async () => {
    taskFindMany.mockResolvedValueOnce([{ id: 20 }]);
    taskCount.mockResolvedValue(2); // 2 open subtasks

    const r = await cleanupCompletedTasks({ keepRecent: 0 });

    expect(r.skippedWithOpenSubtasks).toBe(1);
    expect(r.deletedCount).toBe(0);
    expect(taskDelete).not.toHaveBeenCalled();
  });

  describe('fault injection — knowledge-loss-before-delete', () => {
    test('knowledgeEntry.count が失敗した場合、削除せずスキップすること', async () => {
      // A transient count failure must NOT be treated as "no knowledge yet" —
      // that would (combined with a failing/no-op extraction) delete a task
      // whose lessons were never actually verified as captured.
      taskFindMany.mockResolvedValueOnce([{ id: 50 }]);
      knowledgeCount.mockRejectedValueOnce(new Error('transient DB error'));

      const r = await cleanupCompletedTasks({ keepRecent: 0 });

      expect(r.deletedCount).toBe(0);
      expect(taskDelete).not.toHaveBeenCalled();
      expect(extractKnowledgeFromTask).not.toHaveBeenCalled();
    });

    test('extractKnowledgeFromTask が失敗した場合、削除せずスキップすること', async () => {
      // A thrown extraction error must skip deletion this cycle rather than
      // be treated the same as "extraction ran fine and found nothing".
      taskFindMany.mockResolvedValueOnce([{ id: 51 }]);
      knowledgeCount.mockResolvedValue(0); // not recorded yet → tries to extract
      extractKnowledgeFromTask.mockRejectedValueOnce(new Error('extractor crashed'));

      const r = await cleanupCompletedTasks({ keepRecent: 0 });

      expect(r.deletedCount).toBe(0);
      expect(taskDelete).not.toHaveBeenCalled();
      expect(r.knowledgeRecorded).toBe(0);
    });

    test('a genuinely-empty extraction result (no error) still deletes as before', async () => {
      taskFindMany.mockResolvedValueOnce([{ id: 52 }]);
      knowledgeCount.mockResolvedValue(0);
      extractKnowledgeFromTask.mockResolvedValueOnce([]); // ran fine, nothing to keep

      const r = await cleanupCompletedTasks({ keepRecent: 0 });

      expect(r.deletedCount).toBe(1);
      expect(taskDelete).toHaveBeenCalledTimes(1);
      expect(r.knowledgeRecorded).toBe(0);
    });
  });
});
