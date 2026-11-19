/**
 * PlacementScope
 *
 * Workspace rules for everything a note points at (design §2.2「ワークスペース」):
 * a related row — placement target, source task, linked task — is fetched
 * with an explicit workspace condition and compared for equality with the
 * request's workspace (NULL matches only NULL). A miss and a row in another
 * workspace are the same answer, so nothing leaks about other workspaces.
 *
 * Also the background rule: a job reads a row without scope, takes the row's
 * own workspaceId as its membership, and does the rest inside that workspace.
 *
 * Not responsible for the note row itself — see note-scope.
 */
import { runInWorkspace } from '../../tenancy/workspace-context';
import { requestWorkspaceId } from '../note-scope';
import type { PrismaInstance } from '../note-record';

/** A row that carries its workspace. */
export interface Owned {
  workspaceId: number | null;
}

/**
 * Equality of a row's workspace with an expected one. NULL equals only NULL.
 *
 * @param row - The fetched row, or null / 取得した行
 * @param workspaceId - The expected workspace / 期待するワークスペース
 * @returns true when the row exists and belongs there / 存在して所属が一致すれば true
 */
export function belongsTo(row: Owned | null | undefined, workspaceId: number | null): boolean {
  return !!row && (row.workspaceId ?? null) === workspaceId;
}

/**
 * Run `fn` as a member of `workspaceId`: inside runInWorkspace for a number,
 * as-is for the NULL partition (requestWorkspaceId() is then null, so every
 * explicit condition says `workspaceId: null`).
 *
 * @param workspaceId - The membership a job settled on / 確定した所属
 * @param fn - The work / 処理
 * @returns What fn resolves to / fn の結果
 */
export async function inWorkspaceOf<T>(
  workspaceId: number | null,
  fn: () => Promise<T>,
): Promise<T> {
  return workspaceId === null ? fn() : runInWorkspace(workspaceId, fn);
}

/** A task as the placement code reads it. */
export interface ScopedTask extends Owned {
  id: number;
  themeId: number | null;
  parentId: number | null;
  title?: string;
}

const TASK_SELECT = {
  id: true,
  workspaceId: true,
  themeId: true,
  parentId: true,
  title: true,
} as const;

/**
 * A task in the request's workspace, or null.
 *
 * @param db - Client or transaction / クライアント
 * @param taskId - The task / タスクID
 * @returns The task when it is in scope / 範囲内のタスク
 */
export async function findTaskInScope(
  db: PrismaInstance,
  taskId: number,
): Promise<ScopedTask | null> {
  const ws = requestWorkspaceId();
  const row = (await db.task.findFirst({
    where: { id: taskId, workspaceId: ws },
    select: TASK_SELECT,
  })) as ScopedTask | null;
  return belongsTo(row, ws) ? row : null;
}

/**
 * Tasks in the request's workspace, by id; ids outside it are simply absent.
 *
 * @param db - Client or transaction / クライアント
 * @param taskIds - The tasks / タスクID
 * @returns id → task / ID とタスクの対応
 */
export async function findTasksInScope(
  db: PrismaInstance,
  taskIds: number[],
): Promise<Map<number, ScopedTask>> {
  const ws = requestWorkspaceId();
  const out = new Map<number, ScopedTask>();
  if (taskIds.length === 0) return out;
  const rows = (await db.task.findMany({
    where: { id: { in: [...new Set(taskIds)] }, workspaceId: ws },
    select: TASK_SELECT,
  })) as ScopedTask[];
  for (const row of rows) if (belongsTo(row, ws)) out.set(row.id, row);
  return out;
}

/** Which placement targets exist in a workspace. */
export type PlacementTargetModel = 'theme' | 'category' | 'noteFolder';

/**
 * Whether a placement target (theme, category, folder) is in the request's
 * workspace.
 *
 * @param db - Client or transaction / クライアント
 * @param model - Which table / 対象の表
 * @param id - The target / 配置先ID
 * @returns true when it is in scope / 範囲内なら true
 */
export async function isTargetInScope(
  db: PrismaInstance,
  model: PlacementTargetModel,
  id: number,
): Promise<boolean> {
  const ws = requestWorkspaceId();
  const delegate = db[model] as unknown as {
    findFirst: (args: unknown) => Promise<Owned | null>;
  };
  const row = await delegate.findFirst({
    where: { id, workspaceId: ws },
    select: { id: true, workspaceId: true },
  });
  return belongsTo(row, ws);
}
