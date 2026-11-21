/**
 * auto-run-rework-summary
 *
 * Read-only view of how often a task was sent back to an earlier workflow
 * phase (差し戻し), for the auto-run progress strip. A send-back is any
 * recorded transition whose target comes before its source in the phase
 * order, whatever caused it (verify/CI repair, replan, critic, reset).
 * Not responsible for causing or preventing send-backs.
 */
import { prisma } from '../../../config';

// Phase order of the workflow statuses. awaiting_question and anything else
// outside this list are left out: returning from a question is not a send-back.
const PHASE_ORDER: Record<string, number> = {
  draft: 0,
  research_done: 1,
  plan_created: 2,
  plan_approved: 3,
  in_progress: 4,
  verify_done: 5,
  completed: 6,
};

/** One recorded workflow transition, as far as the summary needs it. */
export interface TransitionRow {
  fromStatus: string | null;
  toStatus: string;
  cause: string;
  createdAt: Date;
}

/** How often a task was sent back, and the most recent send-back. */
export interface ReworkSummary {
  /** Number of backward transitions. / 差し戻しの回数 */
  count: number;
  /** Status the latest send-back left. / 直近の差し戻し元 */
  lastFromStatus: string;
  /** Status the latest send-back returned to. / 直近の差し戻し先 */
  lastToStatus: string;
  /** Cause label of the latest send-back. / 直近の差し戻しの原因ラベル */
  lastCause: string;
  /** When the latest send-back happened (ISO). / 直近の差し戻し時刻 */
  lastAt: string;
}

/**
 * Summarise the backward transitions in a task's history.
 *
 * @param rows - The task's transitions, any order / タスクの遷移履歴
 * @returns The summary, or null when the task never moved backward / 差し戻しの要約（無ければ null）
 */
export function summarizeRework(rows: TransitionRow[]): ReworkSummary | null {
  const backward = rows.filter((row) => {
    if (!row.fromStatus) return false;
    const from = PHASE_ORDER[row.fromStatus];
    const to = PHASE_ORDER[row.toStatus];
    return from !== undefined && to !== undefined && to < from;
  });
  if (backward.length === 0) return null;
  const last = backward.reduce((a, b) => (b.createdAt > a.createdAt ? b : a));
  return {
    count: backward.length,
    lastFromStatus: last.fromStatus as string,
    lastToStatus: last.toStatus,
    lastCause: last.cause,
    lastAt: last.createdAt.toISOString(),
  };
}

/**
 * Load a task's send-back summary from its recorded transitions.
 *
 * @param taskId - Task to summarise / 対象タスクID
 * @returns The summary, or null when there was no send-back / 差し戻しの要約（無ければ null）
 */
export async function loadReworkSummary(taskId: number): Promise<ReworkSummary | null> {
  const rows = await prisma.workflowTransition.findMany({
    where: { taskId },
    select: { fromStatus: true, toStatus: true, cause: true, createdAt: true },
  });
  return summarizeRework(rows);
}
