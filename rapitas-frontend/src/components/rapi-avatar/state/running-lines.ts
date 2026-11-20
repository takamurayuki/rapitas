/**
 * running-lines
 *
 * Turns the running executions into the short lines ラピ's bubble shows:
 * which task, and which phase of it. Pure — the host translates the phase.
 *
 * The bubble used to say only 「エージェントが実行中です。」 (reported
 * 2026-11-20); what was running sat as cards in the panel's chat.
 */
import type { ResumableExecution } from '@/components/resumable-executions/types';

/** How many tasks the bubble names before it says 「ほか N 件」. */
export const RUNNING_LINES_MAX = 3;

/** A phase, as a key of `workflow.statusIndicator`. */
export type RunningPhase =
  | 'researching'
  | 'planning'
  | 'implementing'
  | 'verifying'
  | 'awaitingAnswer';

/** One running task, as the bubble names it. */
export interface RunningLine {
  /** Execution id. / 実行ID */
  id: number;
  /** Task id. / タスクID */
  taskId: number;
  /** Task title. / タスク名 */
  title: string;
  /** The phase running, or null when it cannot be told. / 実行中のフェーズ */
  phase: RunningPhase | null;
}

/**
 * The phase that runs at each workflow status.
 *
 * NOTE: A status names the phase that FINISHED, so the one running is the
 * next — the same reading as `WorkflowStatusIndicator`. Lightweight has no
 * plan, so its research_done runs the implementer.
 */
function phaseOf(exec: ResumableExecution): RunningPhase | null {
  if (exec.status === 'waiting_for_input') return 'awaitingAnswer';
  switch (exec.workflowStatus) {
    case 'draft':
      return 'researching';
    case 'research_done':
      return exec.workflowMode === 'lightweight' ? 'implementing' : 'planning';
    case 'plan_approved':
      return 'implementing';
    case 'in_progress':
      return 'verifying';
    default:
      return null;
  }
}

/**
 * The lines for the running executions, capped so the bubble stays short.
 *
 * @param executions - Every execution the host knows / 全実行
 * @returns The lines shown and how many were left out / 表示行と省略数
 */
export function runningLines(executions: ResumableExecution[]): {
  lines: RunningLine[];
  more: number;
} {
  const running = executions.filter(
    (e) => e.status === 'running' || e.status === 'waiting_for_input',
  );
  return {
    lines: running.slice(0, RUNNING_LINES_MAX).map((e) => ({
      id: e.id,
      taskId: e.taskId,
      title: e.taskTitle,
      phase: phaseOf(e),
    })),
    more: Math.max(0, running.length - RUNNING_LINES_MAX),
  };
}
