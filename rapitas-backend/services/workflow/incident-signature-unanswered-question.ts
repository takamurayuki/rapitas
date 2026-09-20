/**
 * incident-signature-unanswered-question
 *
 * Pure detector for an intake question left unanswered past a threshold.
 * Split out of incident-signature-detectors to keep that file under the line
 * limit; re-exported there for backward compatibility. NOT responsible for
 * notification delivery.
 */

/**
 * Wait time after which an unanswered intake question counts as stale (default
 * 24h). Rationale: tasks #578/#579 sat in awaiting_question for 4 days
 * (raised 2026-08-13T13:48:35Z, found 2026-08-17) with zero notifications —
 * 24h turns that into a daily reminder while staying quiet for same-day answers.
 */
export const UNANSWERED_QUESTION_THRESHOLD_MS =
  parseInt(process.env.RAPITAS_INCIDENT_UNANSWERED_MS ?? '', 10) || 24 * 60 * 60 * 1000;

/** Task statuses that are terminal — a finished task can never be stagnant. */
export const TERMINAL_TASK_STATUSES = new Set(['done', 'cancelled', 'archived', 'completed']);

/** Snapshot of one task used by the unanswered-question detector. */
export interface UnansweredQuestionInput {
  workflowStatus: string | null;
  /**
   * The task's own status. A finished task's pending question is moot, but the
   * workflowStatus can lag behind it: task #587 has been `done` since 2026-08-23
   * while its workflowStatus stayed `awaiting_question`, so it re-notified once
   * per window forever. The watcher already selects this field — it just never
   * looked at it.
   */
  taskStatus: string;
  /** createdAt of the latest toStatus='awaiting_question' transition, epoch ms
   * (null = no such transition on record). NOT task.updatedAt — enrichment and
   * other side channels touch updatedAt without answering the question. */
  questionRaisedAtMs: number | null;
  /** True when an `intake_question_answered` transition exists for the task. */
  hasAnsweredQuestion: boolean;
  nowMs: number;
  thresholdMs?: number;
}

/**
 * Detects a task stuck waiting on an unanswered intake question beyond the
 * threshold. An unanswered question NEVER advances on its own (unlike normal
 * stagnation, which detectStagnation deliberately excludes as a legitimate
 * pause), so a long wait means the human was never reached — re-surface it.
 * Answered tasks are excluded even if their status lags (double guard on top
 * of the caller's workflowStatus filter).
 *
 * @param input - Task snapshot (see UnansweredQuestionInput). / タスクの質問待ちスナップショット
 * @returns Wait time in ms when stale, otherwise null. / 放置時はstaleMs、非該当はnull
 */
export function detectUnansweredQuestion(
  input: UnansweredQuestionInput,
): { staleMs: number } | null {
  if (input.workflowStatus !== 'awaiting_question') return null;
  if (TERMINAL_TASK_STATUSES.has(input.taskStatus)) return null;
  if (input.hasAnsweredQuestion) return null;
  // No awaiting_question transition on record → the wait start is unknowable;
  // skip rather than guess (avoids false positives on anomalous histories).
  if (input.questionRaisedAtMs === null) return null;
  const staleMs = input.nowMs - input.questionRaisedAtMs;
  if (staleMs < (input.thresholdMs ?? UNANSWERED_QUESTION_THRESHOLD_MS)) return null;
  return { staleMs };
}
