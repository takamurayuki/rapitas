/**
 * auto-run-progress.utils
 *
 * Maps a task's workflowStatus to the four phases the auto-run progress strip
 * draws. Display only: it reads the status the backend already reports and
 * never decides what the run does next.
 */

/** The phases the strip draws, in order. */
export const PROGRESS_STEPS = ['research', 'plan', 'implement', 'verify'] as const;

export type ProgressStep = (typeof PROGRESS_STEPS)[number];
export type ProgressStepState = 'done' | 'current' | 'waiting' | 'pending';

/** How far the task is, as the strip draws it. */
export interface ProgressView {
  /** State of each phase, keyed by phase. / 各工程の状態 */
  steps: Record<ProgressStep, ProgressStepState>;
  /** Set when the task waits on the user. / ユーザー待ちの種類 */
  waitingFor: 'approval' | 'answer' | null;
}

/**
 * Build the strip's view from a task's workflowStatus.
 *
 * NOTE: `research_done` marks only research as done. A lightweight task goes
 * straight to implement and a standard one to plan, and the state endpoint
 * does not say which mode the task is in, so the next phase is not guessed.
 *
 * @param workflowStatus - The task's workflowStatus, or null before research / タスクのワークフロー状態
 * @returns Phase states and what the task waits on / 各工程の状態と待ちの種類
 */
export function progressFromWorkflowStatus(workflowStatus: string | null): ProgressView {
  const upTo = (doneCount: number, next: ProgressStepState | null): ProgressView['steps'] => {
    const steps = {} as ProgressView['steps'];
    PROGRESS_STEPS.forEach((step, i) => {
      steps[step] = i < doneCount ? 'done' : i === doneCount && next ? next : 'pending';
    });
    return steps;
  };

  switch (workflowStatus) {
    case null:
    case 'draft':
      return { steps: upTo(0, 'current'), waitingFor: null };
    case 'research_done':
      return { steps: upTo(1, null), waitingFor: null };
    case 'plan_created':
      return { steps: upTo(1, 'waiting'), waitingFor: 'approval' };
    case 'plan_approved':
    case 'in_progress':
      return { steps: upTo(2, 'current'), waitingFor: null };
    case 'verify_done':
    case 'completed':
      return { steps: upTo(4, null), waitingFor: null };
    case 'awaiting_question':
      // The status before the question is not reported, so no phase is lit.
      return { steps: upTo(0, null), waitingFor: 'answer' };
    default:
      return { steps: upTo(0, null), waitingFor: null };
  }
}
