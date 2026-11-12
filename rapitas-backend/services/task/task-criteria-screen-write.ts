/**
 * task-criteria-screen-write
 *
 * The task screen's criteria edit (PATCH /tasks/:id → updateTask): runs the
 * goals / constraints / acceptance criteria of an update through
 * writeTaskCriteria and turns a refusal into the HTTP error the route returns
 * (409 with the refusal code). Not responsible for the other fields.
 */
import { ConflictError } from '../../middleware/error-handler';
import { writeTaskCriteria, type CriteriaWriteDb } from './task-criteria-write';
import { CRITERIA_REFUSAL_MESSAGES } from './task-criteria-messages';

/**
 * Write the criteria part of a task update, if it has one.
 *
 * @param db - Prisma client / Prismaクライアント
 * @param taskId - Task id / タスクID
 * @param fields - The update's criteria fields / 更新の条件フィールド
 * @param expectedCriteriaRevision - Revision the edit was based on (optional for legacy clients) / 編集の元にした版
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
