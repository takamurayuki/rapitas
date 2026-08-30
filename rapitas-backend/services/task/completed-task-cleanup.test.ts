/**
 * completed-task-cleanup ユニットテスト
 *
 * cleanupCompletedTasks の分岐（keepRecent正規化・themeIdスコープ・dryRun・
 * 知識未記録/既記録・オープンサブタスクによるスキップ・タスク単位の例外握りつぶし）
 * および内部の deleteTaskWithArtifacts の副作用（worktree除去・workflow dir削除・
 * タスク削除）を検証する。
 *
 * prisma / getProjectRoot / removeWorktree /
 * extractKnowledgeFromTask はすべてモジュール直import（引数注入ではない）ため、
 * mock.module が必須。
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
const taskDelete = mock(() => Promise.resolve({})) as ReturnType<typeof mock>;

const fakePrisma = {
  task: {
    findMany: taskFindMany,
    count: taskCount,
    findUnique: taskFindUnique,
    delete: taskDelete,
  },
  knowledgeEntry: { count: knowledgeEntryCount },
  agentSession: { findMany: agentSessionFindMany, update: agentSessionUpdate },
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
  taskDelete.mockReset();
  taskDelete.mockResolvedValue({});
  getProjectRootMock.mockReset();
  getProjectRootMock.mockReturnValue('/tmp/project-root');
  removeWorktreeMock.mockReset();
  removeWorktreeMock.mockResolvedValue(true);
  extractKnowledgeFromTaskMock.mockReset();
  extractKnowledgeFromTaskMock.mockResolvedValue([]);
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
    expect(taskDelete).toHaveBeenCalledWith({ where: { id: 5 } });
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
    expect(taskDelete).not.toHaveBeenCalled();
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
    expect(taskDelete).not.toHaveBeenCalled();
  });

  test('taskDeleteが例外を投げた場合 → deletedCountに加算されないこと', async () => {
    taskFindMany.mockResolvedValueOnce([completedTask(12)]);
    knowledgeEntryCount.mockResolvedValueOnce(1);
    taskDelete.mockRejectedValueOnce(new Error('FK violation'));

    const result = await cleanupCompletedTasks({ keepRecent: 0 });

    expect(result.deletedCount).toBe(0);
    expect(result.deletedTaskIds).toEqual([]);
  });
});

describe('cleanupCompletedTasks — deleteTaskWithArtifacts の副作用', () => {
  test('worktreeを持つセッションがある場合 → removeWorktreeとagentSession.updateが呼ばれること', async () => {
    taskFindMany.mockResolvedValueOnce([completedTask(20)]);
    knowledgeEntryCount.mockResolvedValueOnce(1);
    taskFindUnique.mockResolvedValueOnce({ workingDirectory: '/projects/task-20' });
    agentSessionFindMany.mockResolvedValueOnce([
      { id: 1, worktreePath: '/projects/task-20/.worktrees/a' },
    ]);

    await cleanupCompletedTasks({ keepRecent: 0 });

    expect(removeWorktreeMock).toHaveBeenCalledWith(
      '/projects/task-20',
      '/projects/task-20/.worktrees/a',
    );
    expect(agentSessionUpdate).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { worktreePath: null },
    });
  });

  test('task.workingDirectoryが無くtheme.workingDirectoryがある場合 → themeのworkingDirectoryがbaseDirとして使われること', async () => {
    taskFindMany.mockResolvedValueOnce([completedTask(25)]);
    knowledgeEntryCount.mockResolvedValueOnce(1);
    taskFindUnique.mockResolvedValueOnce({
      workingDirectory: null,
      theme: { workingDirectory: '/projects/theme-dir' },
    });
    agentSessionFindMany.mockResolvedValueOnce([
      { id: 5, worktreePath: '/projects/theme-dir/.worktrees/a' },
    ]);

    await cleanupCompletedTasks({ keepRecent: 0 });

    expect(removeWorktreeMock).toHaveBeenCalledWith(
      '/projects/theme-dir',
      '/projects/theme-dir/.worktrees/a',
    );
  });

  test('taskのworkingDirectoryが無い場合 → getProjectRootがbaseDirとして使われること', async () => {
    taskFindMany.mockResolvedValueOnce([completedTask(21)]);
    knowledgeEntryCount.mockResolvedValueOnce(1);
    taskFindUnique.mockResolvedValueOnce({ workingDirectory: null });
    agentSessionFindMany.mockResolvedValueOnce([{ id: 2, worktreePath: '/wt/b' }]);

    await cleanupCompletedTasks({ keepRecent: 0 });

    expect(removeWorktreeMock).toHaveBeenCalledWith('/tmp/project-root', '/wt/b');
  });

  test('removeWorktreeがfalseを返す場合 → agentSession.updateは呼ばれないこと', async () => {
    taskFindMany.mockResolvedValueOnce([completedTask(25)]);
    knowledgeEntryCount.mockResolvedValueOnce(1);
    taskFindUnique.mockResolvedValueOnce({ workingDirectory: '/projects/task-25' });
    agentSessionFindMany.mockResolvedValueOnce([
      { id: 5, worktreePath: '/projects/task-25/.worktrees/a' },
    ]);
    removeWorktreeMock.mockResolvedValueOnce(false);

    await cleanupCompletedTasks({ keepRecent: 0 });

    expect(removeWorktreeMock).toHaveBeenCalledWith(
      '/projects/task-25',
      '/projects/task-25/.worktrees/a',
    );
    expect(agentSessionUpdate).not.toHaveBeenCalled();
  });

  test('worktreePathがnullのセッションは除去処理をスキップすること', async () => {
    taskFindMany.mockResolvedValueOnce([completedTask(22)]);
    knowledgeEntryCount.mockResolvedValueOnce(1);
    agentSessionFindMany.mockResolvedValueOnce([{ id: 3, worktreePath: null }]);

    await cleanupCompletedTasks({ keepRecent: 0 });

    expect(removeWorktreeMock).not.toHaveBeenCalled();
  });

  test('removeWorktreeが例外を投げても削除処理全体は継続すること', async () => {
    taskFindMany.mockResolvedValueOnce([completedTask(23)]);
    knowledgeEntryCount.mockResolvedValueOnce(1);
    agentSessionFindMany.mockResolvedValueOnce([{ id: 4, worktreePath: '/wt/c' }]);
    removeWorktreeMock.mockRejectedValueOnce(new Error('git error'));

    const result = await cleanupCompletedTasks({ keepRecent: 0 });

    expect(result.deletedCount).toBe(1);
    expect(taskDelete).toHaveBeenCalledWith({ where: { id: 23 } });
  });

  test('task.findUniqueが例外を投げても、task削除は継続すること', async () => {
    taskFindMany.mockResolvedValueOnce([completedTask(24)]);
    knowledgeEntryCount.mockResolvedValueOnce(1);
    taskFindUnique.mockRejectedValueOnce(new Error('DB error'));

    const result = await cleanupCompletedTasks({ keepRecent: 0 });

    expect(result.deletedCount).toBe(1);
    expect(taskDelete).toHaveBeenCalledWith({ where: { id: 24 } });
  });
});
