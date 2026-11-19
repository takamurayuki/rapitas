/**
 * NoteFollow
 *
 * Following a deliverable's source task (design §2.2 contracts 5 and 7):
 *
 * - `followTaskThemeChange`: after a task's theme or parent changed, move the
 *   following deliverables of that task and of its theme-less descendants to
 *   their new effective theme — only when it is a non-NULL value. A theme
 *   removed (effective theme NULL) moves nothing.
 * - `resetPlacementToTask`: 「タスクの分類に戻す」 — back to the effective theme
 *   (or 未分類 when there is none) with following switched back on; 404 when
 *   the source task is in another workspace, 409 when it is gone.
 *
 * Every write is a conditional `updateMany` in the request's workspace, so a
 * person's move made in between (followsTask → false) is never overwritten.
 *
 * Not responsible for the hourly safety net — see placement-consistency-job.
 */
import { createLogger } from '../../../config/logger';
import { runAcrossAllWorkspaces } from '../../tenancy/workspace-context';
import type { PrismaInstance } from '../note-record';
import { requestWorkspaceId } from '../note-scope';
import { resolveEffectiveTheme, tasksInheritingFrom } from './effective-theme';
import { findTaskInScope } from './placement-scope';
import {
  columnsFor,
  isDeliverableSource,
  sameColumns,
  type PlacementColumns,
} from './placement-types';

const logger = createLogger('note-follow');

/** A following note as these functions read it. */
interface FollowingNote extends PlacementColumns {
  id: string;
  sourceTaskId: number | null;
}

/**
 * Move one following note to its source task's effective theme when that is
 * a non-NULL value different from where the note is.
 *
 * @param db - Client or transaction / クライアント
 * @param note - The note's columns / ノートの列
 * @returns true when it moved / 移動したら true
 */
export async function followOne(db: PrismaInstance, note: FollowingNote): Promise<boolean> {
  if (note.sourceTaskId === null) return false;
  const theme = await resolveEffectiveTheme(db, note.sourceTaskId);
  if (theme === null) return false; // contract 5: a NULL effective theme moves nothing
  const target = columnsFor('theme', theme);
  if (sameColumns(note, target)) return false;
  const moved = await db.note.updateMany({
    where: {
      id: note.id,
      workspaceId: requestWorkspaceId(),
      followsTask: true,
      sourceTaskId: note.sourceTaskId,
    },
    data: target,
  });
  return moved.count === 1;
}

/**
 * Re-place the following deliverables of a task whose theme or parent changed.
 *
 * @param db - Client / クライアント
 * @param taskId - The task that changed / 変更されたタスク
 * @returns How many notes moved / 移動した件数
 */
export async function followTaskThemeChange(db: PrismaInstance, taskId: number): Promise<number> {
  const taskIds = await tasksInheritingFrom(db, taskId);
  const notes = (await db.note.findMany({
    where: {
      sourceTaskId: { in: taskIds },
      followsTask: true,
      workspaceId: requestWorkspaceId(),
    },
    select: { id: true, sourceTaskId: true, themeId: true, categoryId: true, folderId: true },
  })) as FollowingNote[];
  let moved = 0;
  for (const note of notes) if (await followOne(db, note)) moved += 1;
  if (moved > 0) logger.info({ taskId, moved }, 'deliverable notes followed their task');
  return moved;
}

/**
 * Fire-and-forget follow after a task update; a failure is logged and left
 * to the hourly consistency check.
 *
 * @param db - Client / クライアント
 * @param taskId - The task that changed / 変更されたタスク
 */
export function followTaskThemeChangeInBackground(db: PrismaInstance, taskId: number): void {
  followTaskThemeChange(db, taskId).catch((err) => {
    logger.warn({ err, taskId }, 'note follow failed; the consistency check will retry');
  });
}

/** Whether any workspace has the task — unscoped on purpose, only existence is asked. */
async function taskExistsAnywhere(db: PrismaInstance, taskId: number): Promise<boolean> {
  const n = (await runAcrossAllWorkspaces(() =>
    db.task.count({ where: { id: taskId } }),
  )) as number;
  return n > 0;
}

/** What a reset did, or why it could not. */
export type ResetOutcome =
  | { ok: true; placement: PlacementColumns }
  | { ok: false; status: 400 | 404 | 409; error: string };

/**
 * 「タスクの分類に戻す」 for one deliverable note (contract 7).
 *
 * @param db - Client / クライアント
 * @param id - The note / ノートID
 * @returns The new columns, or the refusal / 新しい列、または拒否理由
 */
export async function resetPlacementToTask(db: PrismaInstance, id: string): Promise<ResetOutcome> {
  const ws = requestWorkspaceId();
  const note = (await db.note.findFirst({
    where: { id, workspaceId: ws },
    select: { id: true, workspaceId: true, source: true, sourceTaskId: true },
  })) as { workspaceId: number | null; source: string; sourceTaskId: number | null } | null;
  if (!note || (note.workspaceId ?? null) !== ws) {
    return { ok: false, status: 404, error: 'note_not_found' };
  }
  if (!isDeliverableSource(note.source)) {
    return { ok: false, status: 400, error: 'not_a_deliverable' };
  }
  // NOTE: two refusals, kept apart (review G2 must-fix 2, design §2.2 contract 7
  // and「ワークスペース」): a source task in another workspace fails the
  // related-row check (404); a deleted one leaves nothing to go back to (409).
  // Either way placement and followsTask stay as they are.
  const task = note.sourceTaskId === null ? null : await findTaskInScope(db, note.sourceTaskId);
  if (!task) {
    const elsewhere =
      note.sourceTaskId !== null && (await taskExistsAnywhere(db, note.sourceTaskId));
    return elsewhere
      ? { ok: false, status: 404, error: 'source_task_not_found' }
      : { ok: false, status: 409, error: 'source_task_deleted' };
  }
  const theme = await resolveEffectiveTheme(db, task.id);
  const placement = theme === null ? columnsFor('none') : columnsFor('theme', theme);
  const updated = await db.note.updateMany({
    where: { id, workspaceId: ws, sourceTaskId: task.id },
    data: { ...placement, followsTask: true },
  });
  if (updated.count !== 1) return { ok: false, status: 409, error: 'note_changed' };
  return { ok: true, placement };
}
