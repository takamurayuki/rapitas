/**
 * completed-task-cleanup ユニットテスト
 *
 * cleanupCompletedTasks の分岐（keepRecent正規化・themeIdスコープ・dryRun・
 * 知識未記録/既記録・オープンサブタスクによるスキップ・タスク単位の例外握りつぶし）
 * と、削除が共通の choke point を通ること（#1330 レビュー）を検証する。
 *
 * worktree 除去の挙動は task-worktree-cleanup.test.ts へ移した。この経路が
 * 持っていた2つ目の実装を choke point 側へ統合したため、ここで prisma を
 * 覗く形の検証は「どこで消したか」ではなく「何を通ったか」に置き換えている。
 *
 * prisma / extractKnowledgeFromTask / task-deletion はすべてモジュール
 * 直import（引数注入ではない）ため、mock.module が必須。
 *
 * HACK(agent): bun:test の mock.module はプロセスグローバルなため、
 * 各モックモジュールの実エクスポートを全てミラーする。
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const noopLogger = {
  info: () => {},
  error: () => {},
  warn: () => {},
  debug: () => {},
  fatal: () => {},
};

const taskFindMany = mock(() => Promise.resolve([])) as ReturnType<typeof mock>;
const taskCount = mock(() => Promise.resolve(0)) as ReturnType<typeof mock>;
const knowledgeEntryCount = mock(() => Promise.resolve(0)) as ReturnType<typeof mock>;
const taskFindUnique = mock(() => Promise.resolve(null)) as ReturnType<typeof mock>;
const agentSessionFindMany = mock(() => Promise.resolve([])) as ReturnType<typeof mock>;
const agentSessionUpdate = mock(() => Promise.resolve({})) as ReturnType<typeof mock>;
const agentSessionUpdateMany = mock(() => Promise.resolve({ count: 0 })) as ReturnType<typeof mock>;
const taskDelete = mock(() => Promise.resolve({})) as ReturnType<typeof mock>;

const fakePrisma = {
  task: {
    findMany: taskFindMany,
    count: taskCount,
    findUnique: taskFindUnique,
    delete: taskDelete,
  },
  knowledgeEntry: { count: knowledgeEntryCount },
  agentSession: {
    findMany: agentSessionFindMany,
    update: agentSessionUpdate,
    updateMany: agentSessionUpdateMany,
  },
};

mock.module('../../config/database', () => ({
  prisma: fakePrisma,
  ensureDatabaseConnection: () => Promise.resolve(),
}));

mock.module('../../config/logger', () => ({
  createLogger: () => noopLogger,
  logger: noopLogger,
  getBackendLogFilePath: () => '/tmp/backend.log',
}));

const getProjectRootMock = mock(() => '/tmp/project-root') as ReturnType<typeof mock>;

mock.module('../../config', () => ({
  prisma: fakePrisma,
  ensureDatabaseConnection: () => Promise.resolve(),
  logger: noopLogger,
  createLogger: () => noopLogger,
  getDbProvider: () => 'postgresql',
  getInsensitiveMode: () => ({ mode: 'insensitive' }),
  getProjectRoot: getProjectRootMock,
}));

const removeWorktreeMock = mock(() => Promise.resolve(true)) as ReturnType<typeof mock>;

mock.module('../agents/orchestrator/git-operations/worktree/worktree-ops', () => ({
  ensureGitRepository: () => Promise.resolve(),
  validateAndSetupRemote: () => Promise.resolve(),
  rmDirWithRetry: () => Promise.resolve(),
  createWorktree: () => Promise.reject(new Error('not implemented in test')),
  removeWorktree: removeWorktreeMock,
  cleanupStaleWorktrees: () => Promise.resolve(0),
  cleanupOrphanedWorktrees: () => Promise.resolve(0),
}));

mock.module('../workflow/workflow-file-utils', () => ({
  resolveWorkflowDir: () => Promise.resolve(null),
  readWorkflowFile: () => Promise.resolve(null),
  writeWorkflowFile: () => Promise.resolve(),
  archiveWorkflowFile: () => Promise.resolve(),
  cleanupRootWorkflowFiles: () => Promise.resolve(),
  looksLikeAgentLog: () => false,
  sliceFromReportHeading: (text: string) => text,
  extractMarkdownFromOutput: () => null,
}));

const extractKnowledgeFromTaskMock = mock(() => Promise.resolve([])) as ReturnType<typeof mock>;

mock.module('../memory/task-knowledge-extractor', () => ({
  extractKnowledgeFromTask: extractKnowledgeFromTaskMock,
  reflectOnFailure: () => Promise.resolve([]),
  findRelatedKnowledge: () => Promise.resolve([]),
  searchCrossProjectKnowledge: () => Promise.resolve([]),
}));

/** Ids handed to the deletion choke point, and the outcome it answers with. */
const chokePointCalls: Array<{ taskId: number; source: string }> = [];
let chokePointOutcome: 'deleted' | 'protected' | 'not_found' = 'deleted';
let chokePointThrows: Error | null = null;

// The prune goes through the guarded path (#1330 review). It used to clear
// worktrees, snapshot measurements and call `prisma.task.delete` itself, so
// the 921 tasks it removed kept no trash copy. Both exports are mirrored;
// mock.module replaces the whole module.
mock.module('./task-deletion', () => ({
  deleteTaskWithTrash: async (taskId: number, source: string) => {
    if (chokePointThrows) {
      const err = chokePointThrows;
      chokePointThrows = null;
      throw err;
    }
    chokePointCalls.push({ taskId, source });
    return {
      taskId,
      outcome: chokePointOutcome,
      ...(chokePointOutcome === 'deleted' ? { trashId: 1 } : {}),
    };
  },
  deleteTasksWithTrash: async (taskIds: number[]) => ({
    deleted: taskIds,
    protected: [],
    notFound: [],
    trashIds: taskIds.map(() => 1),
  }),
}));

const { cleanupCompletedTasks, DEFAULT_KEEP_RECENT } = await import('./completed-task-cleanup');

function completedTask(id: number) {
  return { id };
}

beforeEach(() => {
  taskFindMany.mockReset();
  taskFindMany.mockResolvedValue([]);
  taskCount.mockReset();
  taskCount.mockResolvedValue(0);
  knowledgeEntryCount.mockReset();
  knowledgeEntryCount.mockResolvedValue(0);
  taskFindUnique.mockReset();
  taskFindUnique.mockResolvedValue(null);
  agentSessionFindMany.mockReset();
  agentSessionFindMany.mockResolvedValue([]);
  agentSessionUpdate.mockReset();
  agentSessionUpdate.mockResolvedValue({});
  agentSessionUpdateMany.mockReset();
  agentSessionUpdateMany.mockResolvedValue({ count: 0 });
  taskDelete.mockReset();
  taskDelete.mockResolvedValue({});
  getProjectRootMock.mockReset();
  getProjectRootMock.mockReturnValue('/tmp/project-root');
  removeWorktreeMock.mockReset();
  removeWorktreeMock.mockResolvedValue(true);
  extractKnowledgeFromTaskMock.mockReset();
  extractKnowledgeFromTaskMock.mockResolvedValue([]);
  chokePointCalls.length = 0;
  chokePointOutcome = 'deleted';
  chokePointThrows = null;
});

describe('DEFAULT_KEEP_RECENT', () => {
  test('デフォルト保持件数は100であること', () => {
    expect(DEFAULT_KEEP_RECENT).toBe(100);
  });
});

describe('cleanupCompletedTasks — オプション正規化', () => {
  test('オプション省略時 → keepRecent=DEFAULT_KEEP_RECENT・dryRun=false・themeId=nullで実行されること', async () => {
    const result = await cleanupCompletedTasks();

    expect(result.keepRecent).toBe(DEFAULT_KEEP_RECENT);
    expect(result.dryRun).toBe(false);
    expect(result.themeId).toBeNull();
  });

  test('keepRecentが負数の場合 → 0に丸められること', async () => {
    const result = await cleanupCompletedTasks({ keepRecent: -5 });
    expect(result.keepRecent).toBe(0);
  });

  test('keepRecentが小数の場合 → 切り捨てられること', async () => {
    const result = await cleanupCompletedTasks({ keepRecent: 2.9 });
    expect(result.keepRecent).toBe(2);
  });

  test('themeIdが数値で渡された場合 → whereに反映されresultに保持されること', async () => {
    const result = await cleanupCompletedTasks({ themeId: 7 });

    expect(result.themeId).toBe(7);
    const callArgs = taskFindMany.mock.calls[0][0] as { where: Record<string, unknown> };
    expect(callArgs.where.themeId).toBe(7);
  });

  test('themeIdがnullの場合 → whereにthemeId条件が含まれないこと', async () => {
    await cleanupCompletedTasks({ themeId: null });

    const callArgs = taskFindMany.mock.calls[0][0] as { where: Record<string, unknown> };
    expect(callArgs.where.themeId).toBeUndefined();
  });

  test('findManyのwhereにparentId:null・status絞り込み・isProtected除外が含まれること', async () => {
    await cleanupCompletedTasks();

    const callArgs = taskFindMany.mock.calls[0][0] as {
      where: { parentId: null; status: { in: string[] }; isProtected: { not: true } };
    };
    expect(callArgs.where.parentId).toBeNull();
    expect(callArgs.where.status.in).toEqual(['done', 'completed']);
    expect(callArgs.where.isProtected).toEqual({ not: true });
  });
});

describe('cleanupCompletedTasks — candidateCount / keepRecent slicing', () => {
  test('completedTotal件数がkeepRecent以下の場合 → candidateCountは0であること', async () => {
    taskFindMany.mockResolvedValueOnce([completedTask(1), completedTask(2)]);

    const result = await cleanupCompletedTasks({ keepRecent: 5 });

    expect(result.completedTotal).toBe(2);
    expect(result.candidateCount).toBe(0);
    expect(result.deletedCount).toBe(0);
  });

  test('completedTotal件数がkeepRecentを超える場合 → 超過分のみcandidateになること', async () => {
    taskFindMany.mockResolvedValueOnce([completedTask(1), completedTask(2), completedTask(3)]);

    const result = await cleanupCompletedTasks({ keepRecent: 1 });

    expect(result.candidateCount).toBe(2);
    expect(result.deletedTaskIds.sort()).toEqual([2, 3]);
  });
});

describe('cleanupCompletedTasks — dryRun', () => {
  test('dryRun時は知識未記録候補 → knowledgeRecordedを加算し、実際の削除/抽出は行わないこと', async () => {
    taskFindMany.mockResolvedValueOnce([completedTask(1)]);
    knowledgeEntryCount.mockResolvedValueOnce(0);

    const result = await cleanupCompletedTasks({ keepRecent: 0, dryRun: true });

    expect(result.dryRun).toBe(true);
    expect(result.knowledgeRecorded).toBe(1);
    expect(result.alreadyRecorded).toBe(0);
    expect(result.deletedCount).toBe(1);
    expect(result.deletedTaskIds).toEqual([1]);
    expect(extractKnowledgeFromTaskMock).not.toHaveBeenCalled();
    expect(taskDelete).not.toHaveBeenCalled();
  });

  test('dryRun時は知識記録済み候補 → alreadyRecordedを加算すること', async () => {
    taskFindMany.mockResolvedValueOnce([completedTask(1)]);
    knowledgeEntryCount.mockResolvedValueOnce(3);

    const result = await cleanupCompletedTasks({ keepRecent: 0, dryRun: true });

    expect(result.alreadyRecorded).toBe(1);
    expect(result.knowledgeRecorded).toBe(0);
    expect(taskDelete).not.toHaveBeenCalled();
  });

  test('dryRun時はオープンサブタスクがある候補 → skippedWithOpenSubtasksを加算し件数に含めないこと', async () => {
    taskFindMany.mockResolvedValueOnce([completedTask(1)]);
    taskCount.mockResolvedValueOnce(1);

    const result = await cleanupCompletedTasks({ keepRecent: 0, dryRun: true });

    expect(result.skippedWithOpenSubtasks).toBe(1);
    expect(result.deletedCount).toBe(0);
    expect(knowledgeEntryCount).not.toHaveBeenCalled();
  });
});

describe('cleanupCompletedTasks — 実削除（非dryRun）', () => {
  test('知識未記録の場合 → extractKnowledgeFromTaskを呼び、抽出成功でknowledgeRecorded加算後に削除すること', async () => {
    taskFindMany.mockResolvedValueOnce([completedTask(5)]);
    knowledgeEntryCount.mockResolvedValueOnce(0);
    extractKnowledgeFromTaskMock.mockResolvedValueOnce([101, 102]);

    const result = await cleanupCompletedTasks({ keepRecent: 0 });

    expect(extractKnowledgeFromTaskMock).toHaveBeenCalledWith(5);
    expect(result.knowledgeRecorded).toBe(1);
    expect(result.deletedCount).toBe(1);
    expect(result.deletedTaskIds).toEqual([5]);
    // Asserted against the choke point, not prisma: deleting here directly is
    // the bug this path had (#1330 review).
    expect(chokePointCalls).toEqual([{ taskId: 5, source: 'user' }]);
    expect(taskDelete).not.toHaveBeenCalled();
  });

  test('抽出結果が空配列の場合 → knowledgeRecordedは加算されないが削除は行われること', async () => {
    taskFindMany.mockResolvedValueOnce([completedTask(6)]);
    knowledgeEntryCount.mockResolvedValueOnce(0);
    extractKnowledgeFromTaskMock.mockResolvedValueOnce([]);

    const result = await cleanupCompletedTasks({ keepRecent: 0 });

    expect(result.knowledgeRecorded).toBe(0);
    expect(result.deletedCount).toBe(1);
  });

  test('知識記録済みの場合 → extractKnowledgeFromTaskを呼ばず直接削除すること', async () => {
    taskFindMany.mockResolvedValueOnce([completedTask(7)]);
    knowledgeEntryCount.mockResolvedValueOnce(2);

    const result = await cleanupCompletedTasks({ keepRecent: 0 });

    expect(extractKnowledgeFromTaskMock).not.toHaveBeenCalled();
    expect(result.alreadyRecorded).toBe(1);
    expect(result.deletedCount).toBe(1);
  });

  test('オープンサブタスクがある場合 → 知識判定・削除を一切行わずスキップすること', async () => {
    taskFindMany.mockResolvedValueOnce([completedTask(8)]);
    taskCount.mockResolvedValueOnce(2);

    const result = await cleanupCompletedTasks({ keepRecent: 0 });

    expect(result.skippedWithOpenSubtasks).toBe(1);
    expect(result.deletedCount).toBe(0);
    expect(knowledgeEntryCount).not.toHaveBeenCalled();
    expect(chokePointCalls).toEqual([]);
  });

  test('knowledgeEntry.countが例外を投げた場合 → そのタスクをスキップし他候補の処理は継続すること', async () => {
    taskFindMany.mockResolvedValueOnce([completedTask(9), completedTask(10)]);
    knowledgeEntryCount.mockRejectedValueOnce(new Error('DB error'));
    knowledgeEntryCount.mockResolvedValueOnce(1);

    const result = await cleanupCompletedTasks({ keepRecent: 0 });

    expect(result.deletedCount).toBe(1);
    expect(result.deletedTaskIds).toEqual([10]);
  });

  test('extractKnowledgeFromTaskが例外を投げた場合 → そのタスクの削除をスキップすること', async () => {
    taskFindMany.mockResolvedValueOnce([completedTask(11)]);
    knowledgeEntryCount.mockResolvedValueOnce(0);
    extractKnowledgeFromTaskMock.mockRejectedValueOnce(new Error('extraction failed'));

    const result = await cleanupCompletedTasks({ keepRecent: 0 });

    expect(result.deletedCount).toBe(0);
    expect(chokePointCalls).toEqual([]);
  });

  test('削除が例外を投げた場合 → deletedCountに加算されないこと', async () => {
    taskFindMany.mockResolvedValueOnce([completedTask(12)]);
    knowledgeEntryCount.mockResolvedValueOnce(1);
    chokePointThrows = new Error('FK violation');

    const result = await cleanupCompletedTasks({ keepRecent: 0 });

    expect(result.deletedCount).toBe(0);
    expect(result.deletedTaskIds).toEqual([]);
  });
});

// Flagged in the #1330 review: the three bulk routes were routed through the
// guard and this prune was not. Its own comment recorded the cost — 921 tasks
// removed with no trash copy — and the protected check it relied on was only a
// filter in the candidate query, so a task marked protected after selection
// was removed anyway.
describe('the prune goes through the deletion guard', () => {
  test('every candidate is deleted through the choke point, with the source recorded', async () => {
    taskFindMany.mockResolvedValueOnce([completedTask(30), completedTask(31)]);
    knowledgeEntryCount.mockResolvedValue(1);

    const result = await cleanupCompletedTasks({ keepRecent: 0 });

    expect(chokePointCalls).toEqual([
      { taskId: 30, source: 'user' },
      { taskId: 31, source: 'user' },
    ]);
    expect(result.deletedCount).toBe(2);
    // Nothing deletes a Task row here any more.
    expect(taskDelete).not.toHaveBeenCalled();
  });

  test('a task that became protected after selection is not reported as pruned', async () => {
    taskFindMany.mockResolvedValueOnce([completedTask(32)]);
    knowledgeEntryCount.mockResolvedValueOnce(1);
    chokePointOutcome = 'protected';

    const result = await cleanupCompletedTasks({ keepRecent: 0 });

    // A caller that trusts deletedCount would otherwise believe the task is
    // gone while it is still there.
    expect(result.deletedCount).toBe(0);
    expect(result.deletedTaskIds).toEqual([]);
  });

  test('a task something else already removed is not counted as pruned by this run', async () => {
    taskFindMany.mockResolvedValueOnce([completedTask(33)]);
    knowledgeEntryCount.mockResolvedValueOnce(1);
    chokePointOutcome = 'not_found';

    const result = await cleanupCompletedTasks({ keepRecent: 0 });

    expect(result.deletedCount).toBe(0);
    expect(result.deletedTaskIds).toEqual([]);
  });

  test('a dry run reaches the choke point for nothing at all', async () => {
    taskFindMany.mockResolvedValueOnce([completedTask(34)]);

    const result = await cleanupCompletedTasks({ keepRecent: 0, dryRun: true });

    expect(chokePointCalls).toEqual([]);
    expect(result.deletedCount).toBe(1);
  });
});
