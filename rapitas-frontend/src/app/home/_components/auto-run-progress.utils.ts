/**
 * auto-run-progress.utils
 *
 * Maps a task's workflowStatus and workflowMode to the phases the auto-run
 * progress strip draws. Display only: it reads what the backend reports and
 * never decides what the run does next.
 */

export type ProgressStep = 'research' | 'plan' | 'implement' | 'verify';
export type ProgressStepState = 'done' | 'current' | 'waiting' | 'pending';

/** How far the task is, as the strip draws it. */
export interface ProgressView {
  /** The task's own phases in order, with their state. / タスク自身の工程と状態 */
  steps: { key: ProgressStep; state: ProgressStepState }[];
  /** Set when the task waits on the user. / ユーザー待ちの種類 */
  waitingFor: 'approval' | 'answer' | null;
}

const FULL: ProgressStep[] = ['research', 'plan', 'implement', 'verify'];
// Lightweight tasks go research → implement → verify (CLAUDE.md §4).
const LIGHTWEIGHT: ProgressStep[] = ['research', 'implement', 'verify'];

/**
 * The phases a task in the given mode goes through.
 *
 * @param workflowMode - lightweight / standard / comprehensive, or null / ワークフローのモード
 * @returns Phases in order / 工程の並び
 */
export function stepsForMode(workflowMode: string | null | undefined): ProgressStep[] {
  return workflowMode === 'lightweight' ? LIGHTWEIGHT : FULL;
}

/**
 * The phase a workflow status is working on (or redoing after a send-back).
 *
 * @param workflowStatus - Workflow status / ワークフロー状態
 * @param workflowMode - Workflow mode / ワークフローのモード
 * @returns The phase, or null for statuses outside the phases / 対応する工程
 */
export function phaseOfStatus(
  workflowStatus: string | null,
  workflowMode: string | null | undefined,
): ProgressStep | null {
  switch (workflowStatus) {
    case null:
    case 'draft':
      return 'research';
    case 'research_done':
      // The mode decides what follows research. Unknown (older backend): no guess.
      if (workflowMode === 'lightweight') return 'implement';
      return workflowMode ? 'plan' : null;
    case 'plan_created':
      return 'plan';
    case 'plan_approved':
    case 'in_progress':
      return 'implement';
    case 'verify_done':
    case 'completed':
      return 'verify';
    default:
      return null;
  }
}

/** Send-back causes raised by the verify phase (and the CI checks after it). */
const VERIFY_SEND_BACK_CAUSES = new Set(['verify_repair', 'ci_repair']);

/**
 * The phase a send-back left, for the "検証 → 実装" route.
 *
 * NOTE: Read from the cause first. Verification runs while the status is still
 * in_progress, so a verify bounce is recorded as in_progress → plan_approved and
 * the status alone read as 「実装 → 実装」 (task 1534, 2026-11-24).
 *
 * @param rework - The latest send-back / 直近の差し戻し
 * @param workflowMode - Workflow mode / ワークフローのモード
 * @returns The phase it left, or null when unknown / 差し戻し元の工程
 */
export function phaseSendBackLeft(
  rework: { lastFromStatus: string; lastCause: string },
  workflowMode: string | null | undefined,
): ProgressStep | null {
  if (VERIFY_SEND_BACK_CAUSES.has(rework.lastCause)) return 'verify';
  // research_done left means research had been reached, not the next phase.
  if (rework.lastFromStatus === 'research_done') return 'research';
  return phaseOfStatus(rework.lastFromStatus, workflowMode);
}

/**
 * Build the strip's view of a task.
 *
 * NOTE: Built from the CURRENT status every time, so a send-back (e.g.
 * verify → implement) puts the phases after it back to pending — the run
 * redoes them from there, even if they had been finished.
 *
 * @param workflowStatus - The task's workflowStatus, or null before research / ワークフロー状態
 * @param workflowMode - The task's workflowMode / ワークフローのモード
 * @returns Phase states and what the task waits on / 各工程の状態と待ちの種類
 */
export function progressFromWorkflowStatus(
  workflowStatus: string | null,
  workflowMode?: string | null,
): ProgressView {
  const order = stepsForMode(workflowMode);
  const build = (doneCount: number, next: ProgressStepState | null) =>
    order.map((key, i) => ({
      key,
      state: (i < doneCount
        ? 'done'
        : i === doneCount && next
          ? next
          : 'pending') as ProgressStepState,
    }));
  const indexOf = (step: ProgressStep) => order.indexOf(step);

  if (workflowStatus === 'awaiting_question') {
    // The status before the question is not reported, so no phase is lit.
    return { steps: build(0, null), waitingFor: 'answer' };
  }
  if (workflowStatus === 'verify_done' || workflowStatus === 'completed') {
    return { steps: build(order.length, null), waitingFor: null };
  }
  if (workflowStatus === 'plan_created') {
    return { steps: build(indexOf('plan'), 'waiting'), waitingFor: 'approval' };
  }
  const phase = phaseOfStatus(workflowStatus, workflowMode);
  if (phase === null) {
    // research_done with an unknown mode: research is done, the next is not guessed.
    const done = workflowStatus === 'research_done' ? 1 : 0;
    return { steps: build(done, null), waitingFor: null };
  }
  return { steps: build(indexOf(phase), 'current'), waitingFor: null };
}
