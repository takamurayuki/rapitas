/**
 * ExecutingTasksResponse
 *
 * Shapes one GET /tasks/executing response row from an already-filtered
 * AgentExecution row. Not responsible for choosing which rows to show —
 * executing-tasks-filter.ts owns that.
 */

/** Minimal shape of a filtered execution row this mapper reads. */
export interface ExecutingResponseSource {
  id: number;
  status: string;
  startedAt: Date | null;
  question: string | null;
  session: { id: number; createdAt: Date; config: { taskId: number } };
}

/**
 * Builds the response row for one executing execution.
 *
 * @param execution - Filtered execution row / 表示対象の実行行
 * @param parentById - taskId → parentId of the executing tasks / 実行中タスクの親ID
 * @param activeMsByTask - taskId → finished active ms / タスクごとの完了分の累積実働
 * @returns Response row for the executing-tasks list / 実行中一覧の応答1行
 */
export function toExecutingTaskResponse(
  execution: ExecutingResponseSource,
  parentById: Map<number, number | null>,
  activeMsByTask: Map<number, number>,
) {
  const taskId = execution.session.config.taskId;
  return {
    executionId: execution.id,
    sessionId: execution.session.id,
    taskId,
    parentId: parentById.get(taskId) ?? null,
    executionStatus: execution.status,
    startedAt: execution.startedAt,
    // The whole session's start (spans every phase) — see status-route.ts's
    // identical field for why the elapsed-time display must anchor here,
    // not on this row's own startedAt (which resets every new phase).
    sessionStartedAt: execution.session.createdAt,
    // Sum of (completedAt - startedAt) over the task's FINISHED executions
    // (phase / re-run / repair loops included; the live row is excluded —
    // its share is the FE tick from startedAt).
    activeTimeMs: activeMsByTask.get(taskId) ?? 0,
    // NOTE: Only a waiting_for_input row has a question someone can answer.
    // A running row may still carry the previous turn's text until the
    // continuation clears it, so it is never surfaced. The key is always
    // present; null also covers timeout-handler waits that have no question.
    question: execution.status === 'waiting_for_input' ? (execution.question ?? null) : null,
  };
}
