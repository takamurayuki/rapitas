/**
 * EffectiveTheme
 *
 * A task's effective theme (design §2.2 contract 4): its own `themeId`, else
 * its parent's effective theme, up the ancestors. Subtasks do not inherit a
 * theme on creation (§1.7), so this is what places a deliverable.
 *
 * Every read is inside the request's workspace and every row is compared for
 * equality with it: a parent or theme in another workspace ends the walk as
 * "no theme" rather than leaking a placement across workspaces.
 *
 * Not responsible for moving notes — see note-follow and the jobs.
 */
import type { PrismaInstance } from '../note-record';
import { requestWorkspaceId } from '../note-scope';
import { belongsTo, type ScopedTask } from './placement-scope';

/** Ancestors walked before giving up; also what ends a parent cycle. */
export const MAX_PARENT_DEPTH = 16;

const TASK_SELECT = {
  id: true,
  workspaceId: true,
  themeId: true,
  parentId: true,
  title: true,
} as const;

/** Options for one resolution. */
export interface EffectiveThemeOptions {
  /**
   * A theme to treat as absent — the one being deleted, for
   * placementAfterThemeDelete: a task whose own theme is that one falls
   * through to its parent's.
   */
  excludeThemeId?: number;
  /** Rows already read, so a tree build does not re-read shared ancestors. */
  cache?: Map<number, ScopedTask | null>;
}

async function readTask(
  db: PrismaInstance,
  id: number,
  ws: number | null,
  cache?: Map<number, ScopedTask | null>,
): Promise<ScopedTask | null> {
  if (cache?.has(id)) return cache.get(id) ?? null;
  const row = (await db.task.findFirst({
    where: { id, workspaceId: ws },
    select: TASK_SELECT,
  })) as ScopedTask | null;
  const scoped = belongsTo(row, ws) ? row : null;
  cache?.set(id, scoped);
  return scoped;
}

/**
 * Whether a theme is in the workspace, so a task's themeId that points
 * elsewhere is not used as a placement.
 */
async function themeInWorkspace(
  db: PrismaInstance,
  themeId: number,
  ws: number | null,
): Promise<boolean> {
  const row = (await db.theme.findFirst({
    where: { id: themeId, workspaceId: ws },
    select: { id: true, workspaceId: true },
  })) as { workspaceId: number | null } | null;
  return belongsTo(row, ws);
}

/**
 * The effective theme of a task in the request's workspace.
 *
 * @param db - Client or transaction / クライアント
 * @param taskId - The task / タスクID
 * @param options - Excluded theme and a read cache / 除外テーマとキャッシュ
 * @returns The theme id, or null when the task (or every ancestor) has none / 有効テーマ（無ければ null）
 */
export async function resolveEffectiveTheme(
  db: PrismaInstance,
  taskId: number,
  options: EffectiveThemeOptions = {},
): Promise<number | null> {
  const ws = requestWorkspaceId();
  const seen = new Set<number>();
  let current: number | null = taskId;
  for (let depth = 0; current !== null && depth <= MAX_PARENT_DEPTH; depth += 1) {
    if (seen.has(current)) return null; // a parent cycle: no theme, rather than a loop
    seen.add(current);
    const task = await readTask(db, current, ws, options.cache);
    if (!task) return null;
    if (task.themeId !== null && task.themeId !== options.excludeThemeId) {
      return (await themeInWorkspace(db, task.themeId, ws)) ? task.themeId : null;
    }
    current = task.parentId;
  }
  return null;
}

/**
 * The task and its descendants that have no theme of their own — the tasks
 * whose effective theme a theme or parent change on `taskId` can move
 * (contract 5). Bounded by MAX_PARENT_DEPTH levels.
 *
 * @param db - Client or transaction / クライアント
 * @param taskId - The changed task / 変更されたタスク
 * @returns The task id and the inheriting descendants' ids / 対象タスクIDの一覧
 */
export async function tasksInheritingFrom(db: PrismaInstance, taskId: number): Promise<number[]> {
  const ws = requestWorkspaceId();
  const out = [taskId];
  let frontier = [taskId];
  for (let depth = 0; frontier.length > 0 && depth < MAX_PARENT_DEPTH; depth += 1) {
    const children = (await db.task.findMany({
      where: { parentId: { in: frontier }, themeId: null, workspaceId: ws },
      select: { id: true, workspaceId: true },
    })) as { id: number; workspaceId: number | null }[];
    frontier = children.filter((c) => belongsTo(c, ws) && !out.includes(c.id)).map((c) => c.id);
    out.push(...frontier);
  }
  return out;
}
