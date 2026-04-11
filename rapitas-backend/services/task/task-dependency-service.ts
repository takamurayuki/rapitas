/**
 * TaskDependencyService - 宣言的タスク依存関係の管理
 *
 * ユーザーが明示的に指定したタスク間のブロッキング関係を管理する。
 * file-path 自動解析とは独立した機能。
 */

// NOTE: The parallel-execution detectCycles expects Map<number,TaskNode> which
// requires fields we don't have here. Use a lightweight DFS instead.
import { prisma } from '../../config/database';

export interface TaskDependencyInfo {
  id: number;
  fromTaskId: number;
  toTaskId: number;
  type: string;
  lagDays: number;
  createdAt: Date;
  fromTask: {
    id: number;
    title: string;
    status: string;
  };
  toTask: {
    id: number;
    title: string;
    status: string;
  };
}

export interface TaskDependencies {
  blocking: TaskDependencyInfo[]; // このタスクがブロックしているタスク群
  blockedBy: TaskDependencyInfo[]; // このタスクをブロックしているタスク群
}

/**
 * タスク間の依存関係を追加
 * @param fromTaskId 前提タスクID（完了する必要があるタスク）
 * @param toTaskId 後続タスクID（ブロックされるタスク）
 * @param type 依存関係タイプ（MVP では "FS" 固定）
 * @param lagDays 遅延日数（MVP では 0 固定）
 */
export async function addDependency(
  fromTaskId: number,
  toTaskId: number,
  type: string = 'FS',
  lagDays: number = 0,
): Promise<TaskDependencyInfo> {
  // 自己依存チェック
  if (fromTaskId === toTaskId) {
    throw new Error('タスクは自分自身に依存できません');
  }

  // 両方のタスクが存在するかチェック
  const [fromTask, toTask] = await Promise.all([
    prisma.task.findUnique({ where: { id: fromTaskId } }),
    prisma.task.findUnique({ where: { id: toTaskId } }),
  ]);

  if (!fromTask) {
    throw new Error(`前提タスク（ID: ${fromTaskId}）が見つかりません`);
  }
  if (!toTask) {
    throw new Error(`後続タスク（ID: ${toTaskId}）が見つかりません`);
  }

  // 既存の依存関係をチェック
  const existingDependency = await prisma.taskDependency.findUnique({
    where: {
      fromTaskId_toTaskId: {
        fromTaskId,
        toTaskId,
      },
    },
  });

  if (existingDependency) {
    throw new Error('この依存関係は既に存在します');
  }

  // 循環依存チェック
  await checkForCycles(fromTaskId, toTaskId);

  // 依存関係を作成
  const dependency = await prisma.taskDependency.create({
    data: {
      fromTaskId,
      toTaskId,
      type,
      lagDays,
    },
    include: {
      fromTask: {
        select: { id: true, title: true, status: true },
      },
      toTask: {
        select: { id: true, title: true, status: true },
      },
    },
  });

  return dependency;
}

/**
 * タスク間の依存関係を削除
 */
export async function removeDependency(fromTaskId: number, toTaskId: number): Promise<void> {
  const dependency = await prisma.taskDependency.findUnique({
    where: {
      fromTaskId_toTaskId: {
        fromTaskId,
        toTaskId,
      },
    },
  });

  if (!dependency) {
    throw new Error('指定された依存関係が見つかりません');
  }

  await prisma.taskDependency.delete({
    where: {
      fromTaskId_toTaskId: {
        fromTaskId,
        toTaskId,
      },
    },
  });
}

/**
 * 依存関係IDで削除
 */
export async function removeDependencyById(dependencyId: number): Promise<void> {
  const dependency = await prisma.taskDependency.findUnique({
    where: { id: dependencyId },
  });

  if (!dependency) {
    throw new Error('指定された依存関係が見つかりません');
  }

  await prisma.taskDependency.delete({
    where: { id: dependencyId },
  });
}

/**
 * 特定タスクの依存関係を取得
 */
export async function getDependenciesForTask(taskId: number): Promise<TaskDependencies> {
  const [blocking, blockedBy] = await Promise.all([
    // このタスクがブロックしているタスク群
    prisma.taskDependency.findMany({
      where: { fromTaskId: taskId },
      include: {
        fromTask: {
          select: { id: true, title: true, status: true },
        },
        toTask: {
          select: { id: true, title: true, status: true },
        },
      },
    }),
    // このタスクをブロックしているタスク群
    prisma.taskDependency.findMany({
      where: { toTaskId: taskId },
      include: {
        fromTask: {
          select: { id: true, title: true, status: true },
        },
        toTask: {
          select: { id: true, title: true, status: true },
        },
      },
    }),
  ]);

  return {
    blocking,
    blockedBy,
  };
}

/**
 * 完了したタスクによってブロック解除されるタスクを取得
 */
export async function getUnblockedTasks(completedTaskId: number): Promise<number[]> {
  const dependencies = await prisma.taskDependency.findMany({
    where: { fromTaskId: completedTaskId },
    select: { toTaskId: true },
  });

  return dependencies.map((dep) => dep.toTaskId);
}

/**
 * 循環依存をチェック
 */
async function checkForCycles(fromTaskId: number, toTaskId: number): Promise<void> {
  // 現在の全依存関係を取得
  const allDependencies = await prisma.taskDependency.findMany({
    select: { fromTaskId: true, toTaskId: true },
  });

  // 新しい依存関係を追加した状態でチェック
  const edges = allDependencies.map((dep) => ({ from: dep.fromTaskId, to: dep.toTaskId }));
  edges.push({ from: fromTaskId, to: toTaskId });

  // DFS-based cycle detection on the edge list
  const adj = new Map<number, number[]>();
  for (const e of edges) {
    if (!adj.has(e.from)) adj.set(e.from, []);
    adj.get(e.from)!.push(e.to);
  }
  const visited = new Set<number>();
  const stack = new Set<number>();
  function dfs(node: number): boolean {
    if (stack.has(node)) return true;
    if (visited.has(node)) return false;
    visited.add(node);
    stack.add(node);
    for (const next of adj.get(node) ?? []) {
      if (dfs(next)) return true;
    }
    stack.delete(node);
    return false;
  }
  let hasCycle = false;
  for (const node of adj.keys()) {
    if (dfs(node)) {
      hasCycle = true;
      break;
    }
  }
  if (hasCycle) {
    throw new Error('この依存関係を追加すると循環依存が発生します');
  }
}
