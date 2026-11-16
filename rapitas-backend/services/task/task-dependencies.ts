/**
 * task-dependencies
 *
 * 開始条件 (#1559): a task can name other tasks that must be done before it
 * starts. This module validates and stores those links, lists the ones still
 * open, and holds the where-fragment that keeps auto-run from selecting a
 * task that is still waiting. Not responsible for the start conditions in
 * words (`Task.startConditions`), which are shown but not checked.
 *
 * NOTE: the Prisma client in a worktree is the main checkout's until the next
 * dev:tauri start regenerates it, and it does not know TaskDependency yet.
 * The DB access here goes through the narrow `DependencyDb` type so the
 * code compiles either way; CI generates the client from the schema.
 */
import { prisma } from '../../config/database';

/** "Done" for a prerequisite. A cancelled one keeps its dependent waiting, visibly. */
const DONE = 'done';

/**
 * Where-fragment: tasks none of whose prerequisites is unfinished. Merged into
 * selectNextTask and eligibleTopLevelTodoWhere alike — when selection and
 * counting disagree, a theme flaps between running and idle (task 635).
 */
export const UNMET_DEPENDENCIES_EXCLUDED = {
  dependencies: { none: { dependsOn: { status: { not: DONE } } } },
};

/** A link as stored. */
export interface DependencyEdge {
  taskId: number;
  dependsOnTaskId: number;
}

/** A prerequisite as shown to the person. */
export interface Prerequisite {
  id: number;
  title: string;
  status: string;
}

/** Why a set of prerequisites was refused. */
export type DependencyRefusal =
  | { ok: false; code: 'self'; message: string }
  | { ok: false; code: 'unknown'; message: string; ids: number[] }
  | { ok: false; code: 'cycle'; message: string; cycle: number[] };

/**
 * The cycle that adding `dependsOn` to `taskId` would close, or null.
 *
 * @param taskId - The task that would wait / 待つタスク
 * @param dependsOn - What it would wait for / 待つ相手
 * @param edges - Every other stored link / 既存の依存
 * @returns The task ids around the cycle, starting and ending at taskId / 循環の経路
 */
export function findCycle(
  taskId: number,
  dependsOn: number[],
  edges: DependencyEdge[],
): number[] | null {
  const next = new Map<number, number[]>();
  for (const e of edges) {
    if (e.taskId === taskId) continue; // replaced by `dependsOn`
    next.set(e.taskId, [...(next.get(e.taskId) ?? []), e.dependsOnTaskId]);
  }
  next.set(taskId, dependsOn);
  const path: number[] = [taskId];
  const seen = new Set<number>();
  const walk = (node: number): number[] | null => {
    for (const to of next.get(node) ?? []) {
      if (to === taskId) return [...path, to];
      if (seen.has(to)) continue;
      seen.add(to);
      path.push(to);
      const found = walk(to);
      if (found) return found;
      path.pop();
    }
    return null;
  };
  return walk(taskId);
}

/**
 * Check a requested set of prerequisites.
 *
 * @param taskId - The task that waits / 待つタスク
 * @param requested - Task ids it should wait for / 待つ相手のID
 * @param existing - Ids of tasks that exist / 存在するタスクID
 * @param edges - Every stored link / 既存の依存
 * @returns The ids to store, or why not / 保存するIDか拒否理由
 */
export function validateDependencies(
  taskId: number,
  requested: number[],
  existing: ReadonlySet<number>,
  edges: DependencyEdge[],
): { ok: true; ids: number[] } | DependencyRefusal {
  const ids = [...new Set(requested)];
  if (ids.includes(taskId)) {
    return { ok: false, code: 'self', message: 'タスク自身を開始条件にはできません' };
  }
  const unknown = ids.filter((id) => !existing.has(id));
  if (unknown.length > 0) {
    return {
      ok: false,
      code: 'unknown',
      message: `存在しないタスクです: ${unknown.map((id) => `#${id}`).join('、')}`,
      ids: unknown,
    };
  }
  const cycle = findCycle(taskId, ids, edges);
  if (cycle) {
    return {
      ok: false,
      code: 'cycle',
      message: `お互いを待つことになり、どれも始められません: ${cycle.map((id) => `#${id}`).join(' → ')}`,
      cycle,
    };
  }
  return { ok: true, ids };
}

/**
 * What to tell the person about the prerequisites a task still waits for.
 *
 * @param open - Unfinished prerequisites / 未完了の先行タスク
 * @returns One sentence / 案内文
 */
export function prerequisitesMessage(open: Prerequisite[]): string {
  const list = open.map((p) => `#${p.id}「${p.title}」`).join('、');
  return `先に終わらせるタスクがあります: ${list}`;
}

/** The slice of the client this module uses. */
interface DependencyDb {
  taskDependency: {
    findMany(args: unknown): Promise<Array<DependencyEdge & { dependsOn?: Prerequisite }>>;
    deleteMany(args: unknown): Promise<unknown>;
    createMany(args: unknown): Promise<unknown>;
  };
  task: {
    findMany(args: unknown): Promise<Array<{ id: number }>>;
  };
  $transaction<T>(fn: (tx: DependencyDb) => Promise<T>): Promise<T>;
}

const db = prisma as unknown as DependencyDb;

/**
 * The prerequisites of a task, done or not.
 *
 * @param taskId - The task / タスクID
 * @returns Each prerequisite with its status / 先行タスク一覧
 */
export async function listPrerequisites(taskId: number): Promise<Prerequisite[]> {
  const rows = await db.taskDependency.findMany({
    where: { taskId },
    include: { dependsOn: { select: { id: true, title: true, status: true } } },
    orderBy: { dependsOnTaskId: 'asc' },
  });
  return rows.flatMap((r) => (r.dependsOn ? [r.dependsOn] : []));
}

/**
 * The prerequisites a task still waits for.
 *
 * @param taskId - The task / タスクID
 * @returns Unfinished prerequisites / 未完了の先行タスク
 */
export async function openPrerequisites(taskId: number): Promise<Prerequisite[]> {
  return (await listPrerequisites(taskId)).filter((p) => p.status !== DONE);
}

/**
 * Replace the prerequisites of a task.
 *
 * @param taskId - The task that waits / 待つタスク
 * @param requested - Task ids it should wait for / 待つ相手のID
 * @returns The stored ids, or why they were refused / 保存結果か拒否理由
 */
export async function setPrerequisites(
  taskId: number,
  requested: number[],
): Promise<{ ok: true; ids: number[] } | DependencyRefusal> {
  return db.$transaction(async (tx) => {
    const existing = await tx.task.findMany({
      where: { id: { in: [...new Set(requested)] } },
      select: { id: true },
    });
    const edges = await tx.taskDependency.findMany({
      select: { taskId: true, dependsOnTaskId: true },
    });
    const checked = validateDependencies(
      taskId,
      requested,
      new Set(existing.map((t) => t.id)),
      edges,
    );
    if (!checked.ok) return checked;
    await tx.taskDependency.deleteMany({ where: { taskId } });
    if (checked.ids.length > 0) {
      await tx.taskDependency.createMany({
        data: checked.ids.map((dependsOnTaskId) => ({ taskId, dependsOnTaskId })),
      });
    }
    return checked;
  });
}
