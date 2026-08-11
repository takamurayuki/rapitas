/**
 * incident-signature-detectors
 *
 * Pure detection predicates for the self-incident watcher: stagnation of a
 * non-terminal task, tri-state desync across Task/AgentSession/AgentExecution,
 * and a same-cause repeat loop. DB-independent by design — every input is a
 * plain snapshot assembled by the caller, so each detector is unit-testable
 * at its boundaries. NOT responsible for evidence gathering or concern filing.
 */
import { ACTIVE_EXEC } from './workflow-reconciler-requeue';

/** Idle time after which a non-terminal task counts as stagnant (default 30m). */
export const STAGNATION_THRESHOLD_MS =
  parseInt(process.env.RAPITAS_INCIDENT_STAGNATION_MS ?? '', 10) || 30 * 60 * 1000;

/** Lookback window for the same-cause repeat-loop detection (default 60m). */
export const REPEAT_LOOP_WINDOW_MS =
  parseInt(process.env.RAPITAS_INCIDENT_LOOP_WINDOW_MS ?? '', 10) || 60 * 60 * 1000;

/** Minimum same-cause transitions within the window to count as a loop (default 3). */
export const REPEAT_LOOP_MIN_COUNT =
  parseInt(process.env.RAPITAS_INCIDENT_LOOP_MIN_COUNT ?? '', 10) || 3;

/** Task statuses that are terminal — a finished task can never be stagnant. */
const TERMINAL_TASK_STATUSES = new Set(['done', 'cancelled', 'archived', 'completed']);

/**
 * Workflow statuses proving the workflow advanced at least one step. A task
 * whose status is still 'todo' while its workflowStatus is one of these is
 * desynced ('draft' = consistent not-started; 'awaiting_question' = a
 * legitimate pause, excluded everywhere else in the reconciler too).
 */
const ADVANCED_WORKFLOW_STATUSES = new Set([
  'research_done',
  'plan_created',
  'plan_approved',
  'in_progress',
  'verify_done',
  'completed',
]);

/** Session statuses that mean the session terminally failed. */
const FAILED_SESSION_STATUSES = new Set(['failed', 'cancelled']);

/**
 * Execution statuses that still represent a live agent — the SSOT is
 * ACTIVE_EXEC (workflow-reconciler-requeue); wrapped in a Set for O(1) lookup.
 */
const ACTIVE_EXECUTION_STATUSES = new Set(ACTIVE_EXEC);

/** Snapshot of one task used by the stagnation detector. */
export interface StagnationInput {
  taskStatus: string;
  workflowStatus: string | null;
  /** Most recent activity (task update or workflow transition), epoch ms. */
  lastActivityAtMs: number;
  /** True when an ACTIVE_EXEC-status AgentExecution exists for the task. */
  hasLiveExecution: boolean;
  /** True when a queued/running/waiting_approval WorkflowQueueItem exists. */
  hasActiveQueueItem: boolean;
  nowMs: number;
  thresholdMs?: number;
}

/**
 * Detects a stagnant non-terminal task: no activity for the threshold while no
 * agent is running, nothing is queued, and no legitimate wait state applies.
 *
 * @param input - Task snapshot (see StagnationInput). / タスクの現在状態スナップショット
 * @returns Staleness in ms when stagnant, otherwise null. / 停滞時はstaleMs、非停滞はnull
 */
export function detectStagnation(input: StagnationInput): { staleMs: number } | null {
  if (TERMINAL_TASK_STATUSES.has(input.taskStatus)) return null;
  if (input.workflowStatus === 'completed' || input.workflowStatus === 'awaiting_question') {
    return null;
  }
  if (input.hasLiveExecution || input.hasActiveQueueItem) return null;
  const staleMs = input.nowMs - input.lastActivityAtMs;
  if (staleMs < (input.thresholdMs ?? STAGNATION_THRESHOLD_MS)) return null;
  return { staleMs };
}

/** Snapshot of one task's cross-entity state for the tri-state desync detector. */
export interface TriStateDesyncInput {
  taskStatus: string;
  workflowStatus: string | null;
  /** Status of the task's most recently updated AgentSession (null = none). */
  latestSessionStatus: string | null;
  /** Status of that session's most recent AgentExecution (null = none). */
  latestExecutionStatus: string | null;
}

/** Which desync pattern was detected. */
export type TriStateDesyncKind =
  | 'session_failed_execution_active'
  | 'todo_status_workflow_advanced';

/**
 * Detects a Task/AgentSession/AgentExecution state contradiction. Pattern A
 * (session terminally failed but its execution still active) is checked first
 * and wins when both apply — the session/execution anomaly is the more urgent
 * signal. Pattern B: task.status still 'todo' while the workflow advanced.
 *
 * @param input - Cross-entity state snapshot. / 三面の状態スナップショット
 * @returns Detected pattern + human-readable summary, or null. / 検出結果またはnull
 */
export function detectTriStateDesync(
  input: TriStateDesyncInput,
): { kind: TriStateDesyncKind; detail: string } | null {
  if (
    input.latestSessionStatus !== null &&
    FAILED_SESSION_STATUSES.has(input.latestSessionStatus) &&
    input.latestExecutionStatus !== null &&
    ACTIVE_EXECUTION_STATUSES.has(input.latestExecutionStatus)
  ) {
    return {
      kind: 'session_failed_execution_active',
      detail:
        `最新セッションは終端状態(${input.latestSessionStatus})だが、` +
        `配下の最新実行が依然アクティブ(${input.latestExecutionStatus})のまま`,
    };
  }
  if (
    input.taskStatus === 'todo' &&
    input.workflowStatus !== null &&
    ADVANCED_WORKFLOW_STATUSES.has(input.workflowStatus)
  ) {
    return {
      kind: 'todo_status_workflow_advanced',
      detail: `task.status=todo のまま workflowStatus が前進済み(${input.workflowStatus})`,
    };
  }
  return null;
}

/** One workflow transition reduced to what the repeat-loop detector needs. */
export interface RepeatLoopTransition {
  cause: string;
  createdAtMs: number;
}

/**
 * Detects a same-cause repeat loop: the same transition cause firing at least
 * `minCount` times within the trailing window. Ties between causes with equal
 * counts break deterministically by cause name (localeCompare ascending).
 *
 * @param input.transitions - Task transitions (any order). / 対象タスクの遷移一覧
 * @param input.nowMs - Current time (ms). / 現在時刻
 * @param input.windowMs - Window size (default 60m). / 集計窓
 * @param input.minCount - Detection threshold (default 3). / 検出しきい値
 * @returns The dominant looping cause + count, or null. / 最多ループcauseまたはnull
 */
export function detectRepeatLoop(input: {
  transitions: RepeatLoopTransition[];
  nowMs: number;
  windowMs?: number;
  minCount?: number;
}): { cause: string; count: number } | null {
  const windowMs = input.windowMs ?? REPEAT_LOOP_WINDOW_MS;
  const minCount = input.minCount ?? REPEAT_LOOP_MIN_COUNT;
  const windowStart = input.nowMs - windowMs;

  const counts = new Map<string, number>();
  for (const t of input.transitions) {
    if (t.createdAtMs < windowStart || t.createdAtMs > input.nowMs) continue;
    counts.set(t.cause, (counts.get(t.cause) ?? 0) + 1);
  }

  let best: { cause: string; count: number } | null = null;
  for (const [cause, count] of counts) {
    if (count < minCount) continue;
    if (
      best === null ||
      count > best.count ||
      (count === best.count && cause.localeCompare(best.cause) < 0)
    ) {
      best = { cause, count };
    }
  }
  return best;
}
