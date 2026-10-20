/**
 * TaskTrash
 *
 * Keeps a copy of a deleted task so the deletion can be undone.
 *
 * Deleting a task cascades across 43 relations, so by the time anyone regrets
 * it there is nothing left to read. This takes the copy BEFORE the delete —
 * the task's own columns and those of its subtasks, which the cascade is
 * about to take with it.
 *
 * It is a snapshot, not a soft delete. A soft delete would mean every one of
 * the 269 places that read tasks has to exclude the deleted ones, and one
 * missed call site puts a deleted task back in front of the user. This leaves
 * all of them untouched, at the price of an honest limit: restoring brings
 * back the task and its subtasks, not the executions, pull requests and
 * workflow files that were cascaded away.
 *
 * Only for deletions a person asked for. Automatic housekeeping deletes by
 * policy, and filling the trash with things nobody will miss would bury the
 * one row someone is actually looking for.
 */
import type { Prisma } from '../../generated/prisma-postgres';
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';

const logger = createLogger('task-trash');

/** Who asked for the deletion. */
export type TrashSource = 'user' | 'assistant';

/**
 * The task columns worth restoring.
 *
 * An allowlist rather than "everything except id": a column added later is
 * then simply not restored, instead of being passed to `create` and throwing.
 * Relations, timestamps and the id are deliberately absent — a restore makes
 * a new task, it does not resurrect the old row.
 */
const RESTORABLE_FIELDS = [
  'title',
  'description',
  'status',
  'priority',
  'labels',
  'estimatedHours',
  'actualHours',
  'dueDate',
  'subject',
  'themeId',
  'projectId',
  'milestoneId',
  'studyGoalId',
  'isDeveloperMode',
  'isAiTaskAnalysis',
  'agentGenerated',
  'agentExecutable',
  'executionInstructions',
  'goals',
  'constraints',
  'acceptanceCriteria',
] as const;

/** A task row as the snapshot stores it. */
type TaskRow = Record<string, unknown>;

/** What a snapshot holds. */
interface Snapshot {
  task: TaskRow;
  subtasks: TaskRow[];
}

/**
 * Narrow a stored row to the fields a restore may set.
 *
 * A row with no title cannot be restored: the column is required, and a task
 * called nothing would be worse than the one that is missing. Returning null
 * makes that a refusal the caller has to handle rather than a crash inside
 * Prisma.
 *
 * @param row - A task row out of a snapshot / 退避された行
 * @returns The payload for `create`, or null when it has no title / 作成用データ（タイトル無しなら null）
 */
function restorable(row: TaskRow): Prisma.TaskUncheckedCreateInput | null {
  const title = typeof row.title === 'string' ? row.title.trim() : '';
  if (!title) return null;

  const out: TaskRow = { title };
  for (const field of RESTORABLE_FIELDS) {
    if (field === 'title') continue;
    if (row[field] !== undefined && row[field] !== null) out[field] = row[field];
  }

  // The snapshot came out of this same table one delete ago, so its columns
  // already hold the right shapes. TypeScript cannot see that through JSON,
  // and restating twenty narrowings here would not make it any truer — the
  // title, which is the one thing that must exist, is checked above.
  return out as unknown as Prisma.TaskUncheckedCreateInput;
}

/**
 * Copy a task and its subtasks into the trash, before it is deleted.
 *
 * Must be called BEFORE the delete: afterwards the cascade has removed
 * everything there was to copy.
 *
 * @param taskId - The task about to be deleted / これから削除するタスク
 * @param source - Who asked for it / 削除を要求した主体
 * @returns The trash row's id, or null when the task was not found / 退避ID（対象なしなら null）
 */
export async function snapshotTaskForTrash(
  taskId: number,
  source: TrashSource,
): Promise<number | null> {
  const task = (await prisma.task.findUnique({ where: { id: taskId } })) as TaskRow | null;
  if (!task) return null;

  const subtasks = (await prisma.task.findMany({ where: { parentId: taskId } })) as TaskRow[];

  const snapshot: Snapshot = { task, subtasks };
  const row = await prisma.deletedTask.create({
    data: {
      originalTaskId: taskId,
      title: String(task.title ?? ''),
      themeId: typeof task.themeId === 'number' ? task.themeId : null,
      snapshotJson: JSON.stringify(snapshot),
      source,
    },
    select: { id: true },
  });

  logger.info({ taskId, trashId: row.id, subtasks: subtasks.length }, 'task snapshotted to trash');
  return row.id;
}

/** One row as the trash list shows it. */
export interface TrashEntry {
  id: number;
  originalTaskId: number;
  title: string;
  themeId: number | null;
  source: string;
  deletedAt: Date;
  restoredAt: Date | null;
  restoredTaskId: number | null;
}

/**
 * The most recently deleted tasks, newest first.
 *
 * Deliberately without the snapshots: they are whole task rows, and a list
 * does not need them.
 *
 * @param limit - How many to return, capped / 取得件数（上限あり）
 * @returns The rows / 退避済みタスク
 */
export async function listTrash(limit = 50): Promise<TrashEntry[]> {
  return prisma.deletedTask.findMany({
    orderBy: { deletedAt: 'desc' },
    take: Math.min(Math.max(limit, 1), 200),
    select: {
      id: true,
      originalTaskId: true,
      title: true,
      themeId: true,
      source: true,
      deletedAt: true,
      restoredAt: true,
      restoredTaskId: true,
    },
  });
}

/**
 * Put a deleted task back, with its subtasks.
 *
 * The restored task is a new one: the original id is gone, and anything the
 * cascade removed stays gone. Restoring a row twice is refused rather than
 * producing a second copy.
 *
 * @param trashId - The trash row to restore / 復元する退避行
 * @returns The new task, or null when the row is missing or already restored / 新しいタスク（不可なら null）
 */
export async function restoreFromTrash(
  trashId: number,
): Promise<{ id: number; title: string } | null> {
  const row = await prisma.deletedTask.findUnique({ where: { id: trashId } });
  if (!row) return null;
  if (row.restoredAt) {
    logger.info({ trashId }, 'trash row already restored; refusing a second copy');
    return null;
  }

  let snapshot: Snapshot;
  try {
    snapshot = JSON.parse(String(row.snapshotJson)) as Snapshot;
  } catch (err) {
    logger.error({ err, trashId }, 'trash snapshot is unreadable');
    return null;
  }

  const data = restorable(snapshot.task);
  if (!data) {
    logger.error({ trashId }, 'trash snapshot has no title; refusing to restore');
    return null;
  }

  const task = await prisma.task.create({ data });

  for (const subtask of snapshot.subtasks ?? []) {
    const child = restorable(subtask);
    // A nameless subtask is dropped rather than failing the whole restore:
    // the parent coming back is worth more than the one child that cannot.
    if (!child) continue;
    await prisma.task.create({ data: { ...child, parentId: task.id } });
  }

  await prisma.deletedTask.update({
    where: { id: trashId },
    data: { restoredAt: new Date(), restoredTaskId: task.id },
  });

  logger.info(
    { trashId, taskId: task.id, subtasks: snapshot.subtasks?.length ?? 0 },
    'task restored from trash',
  );
  return { id: task.id, title: String(task.title) };
}

/**
 * Drop trash older than a cutoff.
 *
 * @param olderThanDays - Age at which a row stops being worth keeping / 保持日数
 * @returns How many rows went / 削除件数
 */
export async function purgeTrash(olderThanDays = 30): Promise<{ count: number }> {
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
  const result = await prisma.deletedTask.deleteMany({ where: { deletedAt: { lt: cutoff } } });
  logger.info({ olderThanDays, count: result.count }, 'trash purged');
  return { count: result.count };
}
