import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { PrismaClient } from '@prisma/client';
import {
  addDependency,
  removeDependency,
  removeDependencyById,
  getDependenciesForTask,
  getUnblockedTasks,
} from './task-dependency-service';

const prisma = new PrismaClient();

describe('TaskDependencyService', () => {
  let testTasks: Array<{ id: number; title: string }> = [];

  beforeEach(async () => {
    // テスト用のタスクを作成
    const task1 = await prisma.task.create({
      data: { title: 'テストタスク1', description: 'テスト用' },
    });
    const task2 = await prisma.task.create({
      data: { title: 'テストタスク2', description: 'テスト用' },
    });
    const task3 = await prisma.task.create({
      data: { title: 'テストタスク3', description: 'テスト用' },
    });

    testTasks = [task1, task2, task3];
  });

  afterEach(async () => {
    // 依存関係とタスクをクリーンアップ
    await prisma.taskDependency.deleteMany({
      where: {
        OR: [
          { fromTaskId: { in: testTasks.map((t) => t.id) } },
          { toTaskId: { in: testTasks.map((t) => t.id) } },
        ],
      },
    });
    await prisma.task.deleteMany({
      where: { id: { in: testTasks.map((t) => t.id) } },
    });
    testTasks = [];
  });

  describe('addDependency', () => {
    test('正常な依存関係の追加', async () => {
      const dependency = await addDependency(testTasks[0].id, testTasks[1].id);

      expect(dependency.fromTaskId).toBe(testTasks[0].id);
      expect(dependency.toTaskId).toBe(testTasks[1].id);
      expect(dependency.type).toBe('FS');
      expect(dependency.lagDays).toBe(0);
      expect(dependency.fromTask.title).toBe('テストタスク1');
      expect(dependency.toTask.title).toBe('テストタスク2');
    });

    test('自己依存の防止', async () => {
      await expect(addDependency(testTasks[0].id, testTasks[0].id)).rejects.toThrow(
        'タスクは自分自身に依存できません',
      );
    });

    test('存在しないタスクへの依存', async () => {
      await expect(addDependency(testTasks[0].id, 99999)).rejects.toThrow(
        '後続タスク（ID: 99999）が見つかりません',
      );

      await expect(addDependency(99999, testTasks[0].id)).rejects.toThrow(
        '前提タスク（ID: 99999）が見つかりません',
      );
    });

    test('重複依存の防止', async () => {
      await addDependency(testTasks[0].id, testTasks[1].id);

      await expect(addDependency(testTasks[0].id, testTasks[1].id)).rejects.toThrow(
        'この依存関係は既に存在します',
      );
    });

    test('循環依存の検出', async () => {
      // A -> B の依存を作成
      await addDependency(testTasks[0].id, testTasks[1].id);

      // B -> A を追加しようとすると循環になる
      await expect(addDependency(testTasks[1].id, testTasks[0].id)).rejects.toThrow(
        'この依存関係を追加すると循環依存が発生します',
      );
    });

    test('複雑な循環依存の検出 (A->B->C->A)', async () => {
      // A -> B, B -> C の依存を作成
      await addDependency(testTasks[0].id, testTasks[1].id);
      await addDependency(testTasks[1].id, testTasks[2].id);

      // C -> A を追加しようとすると循環になる
      await expect(addDependency(testTasks[2].id, testTasks[0].id)).rejects.toThrow(
        'この依存関係を追加すると循環依存が発生します',
      );
    });
  });

  describe('removeDependency', () => {
    test('正常な依存関係の削除', async () => {
      await addDependency(testTasks[0].id, testTasks[1].id);
      await removeDependency(testTasks[0].id, testTasks[1].id);

      const dependencies = await getDependenciesForTask(testTasks[0].id);
      expect(dependencies.blocking).toHaveLength(0);
    });

    test('存在しない依存関係の削除', async () => {
      await expect(removeDependency(testTasks[0].id, testTasks[1].id)).rejects.toThrow(
        '指定された依存関係が見つかりません',
      );
    });
  });

  describe('removeDependencyById', () => {
    test('IDによる依存関係の削除', async () => {
      const dependency = await addDependency(testTasks[0].id, testTasks[1].id);
      await removeDependencyById(dependency.id);

      const dependencies = await getDependenciesForTask(testTasks[0].id);
      expect(dependencies.blocking).toHaveLength(0);
    });

    test('存在しないIDの削除', async () => {
      await expect(removeDependencyById(99999)).rejects.toThrow(
        '指定された依存関係が見つかりません',
      );
    });
  });

  describe('getDependenciesForTask', () => {
    test('依存関係の取得', async () => {
      // テスト1 -> テスト2, テスト3 -> テスト1 の依存関係を作成
      await addDependency(testTasks[0].id, testTasks[1].id);
      await addDependency(testTasks[2].id, testTasks[0].id);

      const dependencies = await getDependenciesForTask(testTasks[0].id);

      expect(dependencies.blocking).toHaveLength(1);
      expect(dependencies.blocking[0].toTaskId).toBe(testTasks[1].id);

      expect(dependencies.blockedBy).toHaveLength(1);
      expect(dependencies.blockedBy[0].fromTaskId).toBe(testTasks[2].id);
    });

    test('依存関係がないタスク', async () => {
      const dependencies = await getDependenciesForTask(testTasks[0].id);

      expect(dependencies.blocking).toHaveLength(0);
      expect(dependencies.blockedBy).toHaveLength(0);
    });
  });

  describe('getUnblockedTasks', () => {
    test('ブロック解除されるタスクの取得', async () => {
      // テスト1 -> テスト2, テスト1 -> テスト3 の依存関係を作成
      await addDependency(testTasks[0].id, testTasks[1].id);
      await addDependency(testTasks[0].id, testTasks[2].id);

      const unblockedTasks = await getUnblockedTasks(testTasks[0].id);

      expect(unblockedTasks).toHaveLength(2);
      expect(unblockedTasks).toContain(testTasks[1].id);
      expect(unblockedTasks).toContain(testTasks[2].id);
    });

    test('依存先がないタスク', async () => {
      const unblockedTasks = await getUnblockedTasks(testTasks[0].id);
      expect(unblockedTasks).toHaveLength(0);
    });
  });
});
