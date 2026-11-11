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
 * Not responsible for confirmation or the audit log — the routes check the
 * capability and record the act. Not responsible for the one-off backfill —
 * see `companion-backfill.ts`.
 */

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
  closedAt: Date | null;
}

/** The slice of Prisma this module uses — injectable for tests. */
export interface CompanionDb {
  task: {
    findUnique(args: {
      where: { id: number };
      select: { id: true; status: true };
    }): Promise<{ id: number; status: string } | null>;
  };
  taskCompanion: {
    findUnique(args: { where: { taskId: number } }): Promise<CompanionRow | null>;
    create(args: {
      data: { taskId: number; origin: CompanionOrigin; sourceActionId?: number | null };
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
  const task = await db.task.findUnique({
    where: { id: taskId },
    select: { id: true, status: true },
  });
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
      },
    });
    return { ok: true, outcome: 'reopened', companion };
  }
  const companion = await db.taskCompanion.create({ data: { taskId, origin: 'manual' } });
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
