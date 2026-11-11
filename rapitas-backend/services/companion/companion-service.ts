/**
 * CompanionService
 *
 * Reads and writes `TaskCompanion`, the explicit record of which tasks ラピ is
 * seeing through to completion (companion design 4.3). Rows for tasks ラピ
 * creates are written inside the task insert itself (see
 * `task-create-helpers.ts`); this module handles what happens around that:
 * pointing a row at the audit row that caused it, and the manual
 * "伴走して" / "伴走をやめる" pair.
 *
 * Every row carries its task's workspaceId, written explicitly: rows created
 * inside a task's transaction or by a sessionless caller would otherwise be
 * NULL, and once TaskCompanion is scoped such a row is invisible to the same
 * workspace's reads and stops (fix1, G2 review item 1).
 *
 * A row outlives its task: deleting the task closes the row with
 * `task_deleted` in the same transaction as the delete
 * ({@link closeCompanionsForDeletion}).
 *
 * Not responsible for confirmation or the audit log — the routes check the
 * capability and record the act. Not responsible for the one-off backfill —
 * see `companion-backfill.ts`.
 */
import { inheritWorkspace } from '../tenancy/parent-workspace';

/** Where a companion row came from. */
export type CompanionOrigin = 'task_create' | 'roadmap_commit' | 'manual';

/** Why a companion row was closed. */
export type CompanionClosedReason = 'done' | 'stopped_by_user' | 'task_deleted';

/** One row, as this module reads it. */
export interface CompanionRow {
  id: number;
  taskId: number;
  origin: string;
  sourceActionId: number | null;
  startedAt?: Date | string | null;
  closedAt: Date | null;
}

/** The task fields this module reads. */
export interface CompanionTaskRow {
  id: number;
  status: string;
  title: string;
  workspaceId: number | null;
}

/** The task select every read here uses. */
const TASK_SELECT = { id: true, status: true, title: true, workspaceId: true } as const;

/** The slice of Prisma this module uses — injectable for tests. */
export interface CompanionDb {
  task: {
    findUnique(args: {
      where: { id: number };
      select: { id: true; status: true; title: true; workspaceId: true };
    }): Promise<CompanionTaskRow | null>;
  };
  taskCompanion: {
    findUnique(args: { where: { taskId: number } }): Promise<CompanionRow | null>;
    create(args: {
      data: {
        taskId: number;
        origin: CompanionOrigin;
        sourceActionId?: number | null;
        workspaceId?: number;
      };
    }): Promise<CompanionRow>;
    update(args: {
      where: { taskId: number };
      data: Record<string, unknown>;
    }): Promise<CompanionRow>;
    updateMany(args: {
      where: Record<string, unknown>;
      data: Record<string, unknown>;
    }): Promise<{ count: number }>;
  };
}

/**
 * Point the companion rows of just-created tasks at the audit row that made them.
 *
 * Done after the fact because the audit row is written after the tasks exist.
 * Only rows still pointing nowhere are touched, so a later manual start keeps
 * its own source.
 *
 * @param db - Prisma slice / Prisma の一部
 * @param taskIds - Tasks the act created / 作成したタスク
 * @param actionId - The AssistantAction id, or null when it was not stored / 監査行ID
 * @returns How many rows were linked / 紐づけた行数
 */
export async function linkCompanionSource(
  db: CompanionDb,
  taskIds: number[],
  actionId: number | null,
): Promise<number> {
  if (actionId == null || taskIds.length === 0) return 0;
  const { count } = await db.taskCompanion.updateMany({
    where: { taskId: { in: taskIds }, sourceActionId: null },
    data: { sourceActionId: actionId },
  });
  return count;
}

/** Outcome of a manual start. */
export type StartCompanionResult =
  | { ok: true; outcome: 'started' | 'reopened'; companion: CompanionRow }
  | { ok: false; reason: 'task_not_found' | 'task_done' | 'already_active' };

/**
 * Start accompanying a task the user named ("伴走して").
 *
 * A closed row is reopened rather than duplicated (one row per task); its
 * origin becomes `manual` because the user, not the original creation, is why
 * it is open now.
 *
 * @param db - Prisma slice / Prisma の一部
 * @param taskId - Task to accompany / 対象タスク
 * @returns The row, or why nothing changed / 行、または不成立の理由
 */
export async function startCompanion(
  db: CompanionDb,
  taskId: number,
): Promise<StartCompanionResult> {
  const task = await db.task.findUnique({ where: { id: taskId }, select: TASK_SELECT });
  if (!task) return { ok: false, reason: 'task_not_found' };
  // Nothing left to see through; a finished task gets a follow-up task instead
  // (design 段G), never a reopened companion.
  if (task.status === 'done') return { ok: false, reason: 'task_done' };

  const existing = await db.taskCompanion.findUnique({ where: { taskId } });
  if (existing && existing.closedAt === null) return { ok: false, reason: 'already_active' };
  if (existing) {
    const companion = await db.taskCompanion.update({
      where: { taskId },
      data: {
        origin: 'manual',
        sourceActionId: null,
        startedAt: new Date(),
        closedAt: null,
        closedReason: null,
        // Re-stamped so a row written before rows carried a workspace becomes
        // visible to the task's own workspace once it is reopened.
        ...inheritWorkspace(task),
      },
    });
    return { ok: true, outcome: 'reopened', companion };
  }
  const companion = await db.taskCompanion.create({
    data: { taskId, origin: 'manual', ...inheritWorkspace(task) },
  });
  return { ok: true, outcome: 'started', companion };
}

/** Outcome of a manual stop. */
export type StopCompanionResult =
  | { ok: true; closedAt: Date }
  | { ok: false; reason: 'not_active' };

/**
 * Stop accompanying a task ("伴走をやめる").
 *
 * Conditional on the row still being open, so two stops racing cannot both
 * report success.
 *
 * @param db - Prisma slice / Prisma の一部
 * @param taskId - Task to stop accompanying / 対象タスク
 * @returns When it was closed, or why nothing changed / 終了時刻、または不成立の理由
 */
export async function stopCompanion(db: CompanionDb, taskId: number): Promise<StopCompanionResult> {
  const closedAt = new Date();
  const { count } = await db.taskCompanion.updateMany({
    where: { taskId, closedAt: null },
    data: { closedAt, closedReason: 'stopped_by_user' satisfies CompanionClosedReason },
  });
  if (count === 0) return { ok: false, reason: 'not_active' };
  return { ok: true, closedAt };
}

/**
 * Attach the companion row's id to the audit row that changed it.
 *
 * @param db - Prisma slice / Prisma の一部
 * @param taskId - The task / 対象タスク
 * @param actionId - The AssistantAction id / 監査行ID
 */
export async function setCompanionSource(
  db: CompanionDb,
  taskId: number,
  actionId: number | null,
): Promise<void> {
  if (actionId == null) return;
  await db.taskCompanion.updateMany({ where: { taskId }, data: { sourceActionId: actionId } });
}

/** What the confirmation card for "伴走して" / "伴走をやめて" needs to know. */
export type CompanionState =
  | { ok: true; task: CompanionTaskRow; active: boolean; companion: CompanionRow | null }
  | { ok: false; reason: 'task_not_found' };

/**
 * Read a task and whether ラピ is accompanying it, for the draft card.
 *
 * @param db - Prisma slice / Prisma の一部
 * @param taskId - The task / 対象タスク
 * @returns The task, its row and whether it is open / タスク・行・伴走中かどうか
 */
export async function readCompanionState(db: CompanionDb, taskId: number): Promise<CompanionState> {
  const task = await db.task.findUnique({ where: { id: taskId }, select: TASK_SELECT });
  if (!task) return { ok: false, reason: 'task_not_found' };
  const companion = await db.taskCompanion.findUnique({ where: { taskId } });
  return { ok: true, task, companion, active: !!companion && companion.closedAt === null };
}

/** The slice of a transaction client the deletion close needs. */
export interface CompanionDeletionDb {
  task: {
    findMany(args: {
      where: { parentId: { in: number[] } };
      select: { id: true };
    }): Promise<Array<{ id: number }>>;
  };
  taskCompanion: {
    updateMany(args: {
      where: { taskId: { in: number[] }; closedAt: null };
      data: { closedAt: Date; closedReason: CompanionClosedReason };
    }): Promise<{ count: number }>;
  };
}

/** Subtask nesting deeper than this is not something the UI can make. */
const MAX_SUBTASK_DEPTH = 32;

/**
 * Close the companion rows of a task about to be deleted, and of every
 * subtask its delete will cascade to (Task.parentId is onDelete: Cascade).
 *
 * Call inside the same transaction as the delete, so a delete that fails or
 * rolls back leaves the rows open, and one that commits never leaves an open
 * row pointing at nothing. Rows are closed, not removed: when and why ラピ
 * stopped is part of the task's history (design 4.3).
 *
 * @param tx - Transaction client / トランザクションのクライアント
 * @param taskId - The task being deleted / 削除するタスク
 * @returns How many open rows were closed / 閉じた行数
 */
export async function closeCompanionsForDeletion(
  tx: CompanionDeletionDb,
  taskId: number,
): Promise<number> {
  const doomed = [taskId];
  const seen = new Set(doomed);
  let frontier = [taskId];
  for (let depth = 0; depth < MAX_SUBTASK_DEPTH && frontier.length > 0; depth++) {
    const children = await tx.task.findMany({
      where: { parentId: { in: frontier } },
      select: { id: true },
    });
    frontier = children.map((c) => c.id).filter((id) => !seen.has(id));
    for (const id of frontier) {
      seen.add(id);
      doomed.push(id);
    }
  }
  const { count } = await tx.taskCompanion.updateMany({
    where: { taskId: { in: doomed }, closedAt: null },
    data: { closedAt: new Date(), closedReason: 'task_deleted' },
  });
  return count;
}
