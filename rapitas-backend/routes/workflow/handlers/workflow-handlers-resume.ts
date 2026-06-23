/**
 * Workflow Handlers / Resume
 *
 * `awaiting_question` 状態から、保存された previousStatus に復帰する API ハンドラ。
 * question.md がユーザーによって解消（回答記入 or 削除）された後、エージェント実行を
 * 再開させるために呼ばれる。
 */

import { prisma } from '../../../config';
import { recordTransition } from '../../../services/workflow/transition-recorder';
import { ValidationError, NotFoundError } from '../../../middleware/error-handler';
import { createLogger } from '../../../config';
import type { WorkflowStatus } from '../../../services/workflow/workflow-types';
import { resolveTaskWorkflowState } from '../../../services/task/task-resolver';

const log = createLogger('routes:workflow:resume');

interface ResumeContext {
  params: { taskId: string };
  body?: unknown;
  set: { status?: number };
}

/**
 * `awaiting_question` 状態のタスクを、質問発生前の status に復帰させる。
 *
 * 復帰先 status は `WorkflowTransition` の最新 `to_status='awaiting_question'`
 * 行の `metadata.previousStatus` から取得する。metadata に値が無い古い遷移は
 * `in_progress` を fallback に使う。
 *
 * @param ctx - Elysia ハンドラコンテキスト
 * @returns 新しい workflowStatus と復帰先の根拠 / 復帰した状態オブジェクト
 * @throws {ValidationError} taskId が不正、または status が awaiting_question でない場合
 * @throws {NotFoundError} タスクが見つからない場合
 */
export async function handleResumeFromQuestion({ params, set }: ResumeContext): Promise<{
  taskId: number;
  fromStatus: WorkflowStatus;
  toStatus: WorkflowStatus;
  source: 'transition_metadata' | 'fallback';
}> {
  const taskId = parseInt(params.taskId, 10);
  if (Number.isNaN(taskId)) {
    set.status = 400;
    throw new ValidationError('Invalid taskId');
  }

  const task = await resolveTaskWorkflowState(taskId);
  if (!task) {
    set.status = 404;
    throw new NotFoundError('Task not found');
  }

  if (task.workflowStatus !== 'awaiting_question') {
    set.status = 400;
    throw new ValidationError(
      `Cannot resume: task ${taskId} is in status "${task.workflowStatus}", expected "awaiting_question"`,
    );
  }

  // 直近の awaiting_question 遷移ログから previousStatus を読み出す
  const lastWaitingTransition = await prisma.workflowTransition.findFirst({
    where: { taskId, toStatus: 'awaiting_question' },
    orderBy: { createdAt: 'desc' },
    select: { metadata: true, fromStatus: true },
  });

  let resumeStatus: WorkflowStatus = 'in_progress';
  let source: 'transition_metadata' | 'fallback' = 'fallback';
  if (lastWaitingTransition?.metadata) {
    // Prisma's Json field is typed as string|number|boolean|object|array. Narrow via unknown.
    const meta = lastWaitingTransition.metadata as unknown as Record<string, unknown>;
    const prev = meta.previousStatus;
    if (typeof prev === 'string' && prev !== 'awaiting_question') {
      resumeStatus = prev as WorkflowStatus;
      source = 'transition_metadata';
    } else if (lastWaitingTransition.fromStatus) {
      // metadata 欠落でも fromStatus が残っていれば優先する
      resumeStatus = lastWaitingTransition.fromStatus as WorkflowStatus;
      source = 'transition_metadata';
    }
  }

  log.info(
    `[Workflow:Resume] Task ${taskId}: awaiting_question → ${resumeStatus} (source=${source})`,
  );

  await prisma.task.update({
    where: { id: taskId },
    data: { workflowStatus: resumeStatus, updatedAt: new Date() },
  });

  await recordTransition({
    taskId,
    fromStatus: 'awaiting_question',
    toStatus: resumeStatus,
    actor: 'user',
    cause: 'question_resolved',
    metadata: { source },
  });

  return {
    taskId,
    fromStatus: 'awaiting_question',
    toStatus: resumeStatus,
    source,
  };
}
