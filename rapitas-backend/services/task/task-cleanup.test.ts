/**
 * task-cleanup ユニットテスト
 *
 * cleanupDuplicateSubtasks / cleanupAllDuplicateSubtasks の重複判定・削除対象
 * 選定ロジックを検証する。config/logger は bun:test の mock.module が
 * プロセスグローバルなため、全エクスポートをミラーしてスタブ化する。
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';
import type { PrismaClient } from '../../generated/prisma-postgres';

mock.module('../../config/logger', () => {
  const noopLogger = {
    info: () => {},
    error: () => {},
    warn: () => {},
    debug: () => {},
    fatal: () => {},
  };
  return {
    createLogger: () => noopLogger,
    logger: noopLogger,
    getBackendLogFilePath: () => '/tmp/backend.log',
  };
});

/** Ids handed to the deletion choke point, and which it refuses. */
const chokePointDeletes: number[] = [];
const protectedIds: number[] = [];

// Duplicate cleanup goes through the guarded path (#1330 review). It used to
// call prisma.task.delete directly, so a protected duplicate was removed with
// no trash copy and no measurement snapshot — the same hole the three bulk
// routes had. Both exports are mirrored; mock.module replaces the module.
mock.module('./task-deletion', () => ({
  deleteTaskWithTrash: async (taskId: number) => {
    if (protectedIds.includes(taskId)) return { taskId, outcome: 'protected' };
    chokePointDeletes.push(taskId);
    return { taskId, outcome: 'deleted', trashId: 1 };
  },
  deleteTasksWithTrash: async (taskIds: number[]) => {
    const result = {
      deleted: [] as number[],
      protected: [] as number[],
      notFound: [] as number[],
      trashIds: [] as number[],
    };
    for (const id of [...new Set(taskIds)]) {
      if (protectedIds.includes(id)) {
        result.protected.push(id);
        continue;
      }
      chokePointDeletes.push(id);
      result.deleted.push(id);
      result.trashIds.push(1);
    }
    return result;
  },
}));

const { cleanupDuplicateSubtasks, cleanupAllDuplicateSubtasks } = await import('./task-cleanup');

interface FakeSubtask {
  id: number;
  title: string;
  parentId: number | null;
  createdAt: Date;
}

const findMany = mock(() => Promise.resolve([])) as ReturnType<typeof mock>;
const del = mock(() => Promise.resolve({})) as ReturnType<typeof mock>;

function buildPrisma(): PrismaClient {
  return {
    task: { findMany, delete: del },
  } as unknown as PrismaClient;
}

function subtask(id: number, title: string, parentId: number | null, day: number): FakeSubtask {
  return { id, title, parentId, createdAt: new Date(2026, 0, day) };
}

beforeEach(() => {
  findMany.mockReset();
  del.mockReset();
  findMany.mockResolvedValue([]);
  del.mockResolvedValue({});
  chokePointDeletes.length = 0;
  protectedIds.length = 0;
});

describe('cleanupDuplicateSubtasks', () => {
  test('サブタスクが存在しない場合 → 削除せず空配列を返すこと', async () => {
    findMany.mockResolvedValueOnce([]);

    const result = await cleanupDuplicateSubtasks(buildPrisma(), 1);

    expect(result).toEqual([]);
    expect(del).not.toHaveBeenCalled();
  });

  test('重複タイトルが無い場合 → 何も削除しないこと', async () => {
    findMany.mockResolvedValueOnce([subtask(1, 'タスクA', 1, 1), subtask(2, 'タスクB', 1, 2)]);

    const result = await cleanupDuplicateSubtasks(buildPrisma(), 1);

    expect(result).toEqual([]);
    expect(del).not.toHaveBeenCalled();
  });

  test('重複タイトルがある場合 → 最も古い1件を残し、それ以外を削除すること', async () => {
    findMany.mockResolvedValueOnce([
      subtask(1, 'タスクA', 1, 1),
      subtask(2, 'タスクA', 1, 2),
      subtask(3, 'タスクA', 1, 3),
    ]);

    const result = await cleanupDuplicateSubtasks(buildPrisma(), 1);

    expect(result).toEqual([2, 3]);
    // Asserted against the choke point, not the injected client: deleting
    // through `prisma.task.delete` here is the bug this path had (#1330).
    expect(chokePointDeletes).toEqual([2, 3]);
  });

  test('タイトルの大文字小文字・前後空白の違いを無視して重複判定すること', async () => {
    findMany.mockResolvedValueOnce([
      subtask(1, 'Deploy App', 1, 1),
      subtask(2, '  deploy app  ', 1, 2),
      subtask(3, 'DEPLOY APP', 1, 3),
    ]);

    const result = await cleanupDuplicateSubtasks(buildPrisma(), 1);

    expect(result.sort()).toEqual([2, 3]);
  });

  test('複数の重複グループが混在する場合 → それぞれ独立して処理されること', async () => {
    findMany.mockResolvedValueOnce([
      subtask(1, 'A', 1, 1),
      subtask(2, 'A', 1, 2),
      subtask(3, 'B', 1, 1),
      subtask(4, 'B', 1, 2),
      subtask(5, 'C', 1, 1),
    ]);

    const result = await cleanupDuplicateSubtasks(buildPrisma(), 1);

    expect(result.sort((a, b) => a - b)).toEqual([2, 4]);
  });

  test('findMany が parentId で絞り込み、createdAt 昇順で呼ばれること', async () => {
    await cleanupDuplicateSubtasks(buildPrisma(), 42);

    expect(findMany).toHaveBeenCalledWith({
      where: { parentId: 42 },
      orderBy: { createdAt: 'asc' },
    });
  });
});

describe('cleanupAllDuplicateSubtasks', () => {
  test('サブタスクが存在しない場合 → 空の結果を返すこと', async () => {
    findMany.mockResolvedValueOnce([]);

    const result = await cleanupAllDuplicateSubtasks(buildPrisma());

    expect(result).toEqual({ deletedIds: [], affectedParents: [] });
    expect(del).not.toHaveBeenCalled();
  });

  test('複数の親をまたいで重複が存在する場合 → 親ごとに独立して重複排除すること', async () => {
    findMany.mockResolvedValueOnce([
      subtask(1, 'A', 10, 1),
      subtask(2, 'A', 10, 2),
      subtask(3, 'X', 20, 1),
      subtask(4, 'Y', 20, 2),
    ]);

    const result = await cleanupAllDuplicateSubtasks(buildPrisma());

    expect(result.deletedIds).toEqual([2]);
    expect(result.affectedParents).toEqual([10]);
    expect(chokePointDeletes).toEqual([2]);
  });

  test('重複の無い親は affectedParents に含まれないこと', async () => {
    findMany.mockResolvedValueOnce([subtask(1, 'A', 10, 1), subtask(2, 'B', 10, 2)]);

    const result = await cleanupAllDuplicateSubtasks(buildPrisma());

    expect(result.deletedIds).toEqual([]);
    expect(result.affectedParents).toEqual([]);
  });

  test('findMany が parentId: { not: null } で呼ばれること', async () => {
    await cleanupAllDuplicateSubtasks(buildPrisma());

    expect(findMany).toHaveBeenCalledWith({
      where: { parentId: { not: null } },
      orderBy: { createdAt: 'asc' },
    });
  });

  test('同一親に複数の重複グループがある場合 → 全グループの重複が削除され親は1回だけ affectedParents に載ること', async () => {
    findMany.mockResolvedValueOnce([
      subtask(1, 'A', 10, 1),
      subtask(2, 'A', 10, 2),
      subtask(3, 'B', 10, 1),
      subtask(4, 'B', 10, 2),
    ]);

    const result = await cleanupAllDuplicateSubtasks(buildPrisma());

    expect(result.deletedIds.sort((a, b) => a - b)).toEqual([2, 4]);
    expect(result.affectedParents).toEqual([10]);
  });
});

// Flagged in the #1330 review: the three bulk routes were routed through the
// guard, and these two were not. A duplicate is still a task — removing one
// without the protected check, the trash copy or the measurement snapshot
// loses exactly what those exist to keep.
describe('duplicate cleanup goes through the deletion guard', () => {
  test('deletes duplicates through the choke point, not prisma directly', async () => {
    findMany.mockResolvedValueOnce([
      subtask(1, 'タスクA', 1, 1),
      subtask(2, 'タスクA', 1, 2),
      subtask(3, 'タスクA', 1, 3),
    ]);

    const result = await cleanupDuplicateSubtasks(buildPrisma(), 1);

    expect(result).toEqual([2, 3]);
    expect(chokePointDeletes).toEqual([2, 3]);
    // The injected client must not be used to delete any more.
    expect(del).not.toHaveBeenCalled();
  });

  test('keeps a protected duplicate and leaves it out of the result', async () => {
    protectedIds.push(2);
    findMany.mockResolvedValueOnce([
      subtask(1, 'タスクA', 1, 1),
      subtask(2, 'タスクA', 1, 2),
      subtask(3, 'タスクA', 1, 3),
    ]);

    const result = await cleanupDuplicateSubtasks(buildPrisma(), 1);

    // Reported as deleted only if it actually was: a caller that trusts this
    // list would otherwise believe a task is gone while it is still there.
    expect(result).toEqual([3]);
    expect(chokePointDeletes).toEqual([3]);
  });

  test('the all-parents sweep uses the same path', async () => {
    findMany.mockResolvedValueOnce([subtask(1, 'タスクA', 10, 1), subtask(2, 'タスクA', 10, 2)]);

    const result = await cleanupAllDuplicateSubtasks(buildPrisma());

    expect(result.deletedIds).toEqual([2]);
    expect(chokePointDeletes).toEqual([2]);
    expect(del).not.toHaveBeenCalled();
  });

  test('a protected duplicate does not mark its parent as affected', async () => {
    protectedIds.push(2);
    findMany.mockResolvedValueOnce([subtask(1, 'タスクA', 10, 1), subtask(2, 'タスクA', 10, 2)]);

    const result = await cleanupAllDuplicateSubtasks(buildPrisma());

    expect(result.deletedIds).toEqual([]);
    // Nothing changed under that parent, so nothing downstream should resync.
    expect(result.affectedParents).toEqual([]);
  });
});
