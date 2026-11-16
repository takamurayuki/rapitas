/**
 * task-criteria-screen-write
 *
 * The task screen's criteria edit (PATCH /tasks/:id → updateTask): runs the
 * goals / constraints / acceptance criteria of an update through
 * writeTaskCriteria and turns a refusal into the HTTP error the route returns
 * (409 with the refusal code). An edit of any of the three lists must name
 * the revision it was based on (design 4.5) — an update without criteria
 * needs none. Not responsible for the other fields.
 */
import { ConflictError, ValidationError } from '../../middleware/error-handler';
import { writeTaskCriteria, type CriteriaWriteDb } from './task-criteria-write';
import { CRITERIA_REFUSAL_MESSAGES } from './task-criteria-messages';

/** Error code of a criteria edit sent without expectedCriteriaRevision (HTTP 400). */
export const CRITERIA_REVISION_REQUIRED = 'criteria_revision_required';

/**
 * Write the criteria part of a task update, if it has one.
 *
 * @param db - Prisma client / Prismaクライアント
 * @param taskId - Task id / タスクID
 * @param fields - The update's criteria fields / 更新の条件フィールド
 * @param expectedCriteriaRevision - Revision the edit was based on; required when a list is sent / 編集の元にした版（条件を送るときは必須）
 * @throws {ValidationError} 400 criteria_revision_required when a list is sent without a revision / 版なしの条件更新
 * @throws {ConflictError} 409 review_in_progress / criteria_changed_since / task_done / 書き込み拒否
 * @throws {Error} When the task is gone / タスクが無い場合
 */
export async function writeScreenCriteria(
  db: CriteriaWriteDb,
  taskId: number,
  fields: { goals?: string[]; constraints?: string[]; acceptanceCriteria?: string[] },
  expectedCriteriaRevision: string | undefined,
): Promise<void> {
  const { goals, constraints, acceptanceCriteria } = fields;
  if (goals === undefined && constraints === undefined && acceptanceCriteria === undefined) return;
  // NOTE: Required, not optional: without it a client holding an old read
  // could overwrite a change it never saw (the lock and state guards don't
  // catch that). 400 rather than 409 — nothing conflicted, the request is
  // incomplete — and before any write, so the other fields stay unapplied too.
  if (expectedCriteriaRevision === undefined || expectedCriteriaRevision === '') {
    throw new ValidationError(
      '完了条件を変えるときは、元にした条件の版（expectedCriteriaRevision）を送ってください。',
      CRITERIA_REVISION_REQUIRED,
    );
  }
  const written = await writeTaskCriteria(db, {
    taskId,
    next: { goals, constraints, acceptanceCriteria },
    expectedCriteriaRevision,
    actor: 'user:task_screen',
  });
  if (written.ok) return;
  if (written.reason === 'not_found') throw new Error(`タスク(ID: ${taskId})が見つかりません`);
  throw new ConflictError(CRITERIA_REFUSAL_MESSAGES[written.reason], written.reason);
}
