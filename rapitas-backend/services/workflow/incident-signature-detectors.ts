/**
 * incident-signature-detectors
 *
 * Pure detection predicates for the self-incident watcher: stagnation of a
 * non-terminal task, tri-state desync across Task/AgentSession/AgentExecution,
 * and an intake question left unanswered too long. DB-independent by design —
 * every input is a plain snapshot assembled by the caller, so each detector is
 * unit-testable. NOT responsible for evidence gathering or concern filing.
 * The same-cause repeat-loop detector lives in incident-signature-repeat-loop
 * and is re-exported here (barrel) for backward compatibility — see task 855;
 * the unanswered-question detector moved to incident-signature-unanswered-question
 * (line-limit split, task 1003) and is re-exported the same way.
 */
import { BLOCKED_REESCALATION_INTERVAL_MS } from './blocked-task-policy';
import { TERMINAL_TASK_STATUSES } from './incident-signature-unanswered-question';
import { isPlanHoldAwaitingHuman } from './plan-hold-exclusion';
export {
  detectRepeatLoop,
  isRepairBounceCause,
  REPEAT_LOOP_WINDOW_MS,
  REPEAT_LOOP_MIN_COUNT,
  INVARIANT_REPEAT_LOOP_MIN_COUNT,
} from './incident-signature-repeat-loop';
export type { RepeatLoopTransition } from './incident-signature-repeat-loop';
export {
  detectUnansweredQuestion,
  UNANSWERED_QUESTION_THRESHOLD_MS,
} from './incident-signature-unanswered-question';
export type { UnansweredQuestionInput } from './incident-signature-unanswered-question';
export {
  detectTriStateDesync,
  DESYNC_RECOVERY_SETTLE_MS,
  PATTERN_A_SETTLE_MS,
  MANUAL_STOP_WITHDRAW_CAUSE,
  RECOVERY_REQUEUE_CAUSES,
} from './incident-signature-tristate-desync';
export type { TriStateDesyncInput, TriStateDesyncKind } from './incident-signature-tristate-desync';

/** Idle time after which a non-terminal task counts as stagnant (default 30m). */
export const STAGNATION_THRESHOLD_MS =
  parseInt(process.env.RAPITAS_INCIDENT_STAGNATION_MS ?? '', 10) || 30 * 60 * 1000;

/**
 * Transition causes written by blocked-task-escalation (first notice and the
 * 4h re-notice). Duplicated as literals so this pure module stays free of the
 * escalation module's DB imports — keep in sync with blocked-task-escalation.ts.
 */
export const BLOCKED_ESCALATION_CAUSES: ReadonlySet<string> = new Set([
  'blocked_escalated',
  'blocked_reescalated',
]);

/** Snapshot of one task used by the stagnation detector. */
export interface StagnationInput {
  taskStatus: string;
  workflowStatus: string | null;
  /** Most recent activity (task update or workflow transition), epoch ms. */
  lastActivityAtMs: number;
  /** True when an ACTIVE_EXEC-status AgentExecution exists for the task. */
  hasLiveExecution: boolean;
  /** True when any AgentExecution exists for the task, regardless of status. */
  hasAnyExecution: boolean;
  /** True when a queued/running/waiting_approval WorkflowQueueItem exists. */
  hasActiveQueueItem: boolean;
  /**
   * Whether this task can structurally gain a live execution or queue item
   * at all — `false` when `Task.workflowDisabled`/`UserSettings.
   * workflowDisabledGlobally` is set, the task's theme is not a development
   * theme (`Theme.isDevelopment === false`), or the theme's auto-run is
   * disabled (`ThemeAutoRun.enabled === false`). Such a task can never
   * dispatch, so the "no execution, no queue" shape is a legitimate
   * indefinite wait, not stagnation (task #860, e.g. task #811 in a
   * non-development theme). `null`/`undefined` (unresolved) is treated as
   * managed — mirrors `themeAutoRunEnabled`: incomplete input must never
   * silently widen suppression.
   */
  isWorkflowManaged?: boolean | null;
  /**
   * True when the task's newest relevant transition cause is
   * MANUAL_STOP_WITHDRAW_CAUSE — the operator explicitly withdrew this task
   * via stop-execution({withdraw:true}) and decided not to resume it (#875).
   * `null`/`undefined` (unresolved) leaves the task subject to detection —
   * mirrors the other optional gates' fail-open convention.
   */
  manuallyWithdrawn?: boolean | null;
  /**
   * True when a blocked task's most recent blocked_escalated/blocked_reescalated
   * transition is still inside the re-notification window — a human was
   * already told, so the blocked hold is deliberate, not abandoned (#980).
   * `null`/`undefined` leaves the task subject to detection (fail-open).
   */
  blockedEscalationRecent?: boolean | null;
  /**
   * True when the task's theme has auto-run `status === 'running'` and
   * `currentTaskId` is a DIFFERENT task — the theme is actively dispatching
   * another task and this one is simply next in the backlog, not stuck
   * (task #969). `AUTO_RUN_GLOBAL_MAX_CONCURRENCY` defaults to 1, so a busy
   * theme's backlog routinely waits past STAGNATION_THRESHOLD_MS. Does NOT
   * suppress detection when `currentTaskId` is this task itself — a live
   * hang on the task's own turn must still be caught. `null`/`undefined`
   * (unresolved) leaves the task subject to detection — mirrors the other
   * optional gates' fail-open convention.
   */
  themeAutoRunBusyWithOtherTask?: boolean | null;
  /**
   * Epoch ms of the newest `blocked_escalated`/`blocked_reescalated` transition
   * (#979). A `status=blocked` task whose escalation is younger than
   * `blockedHoldMs` is a human-wait hold already reported through the
   * escalation notice — not stagnation. `null`/`undefined` (never escalated or
   * unresolved) leaves the task subject to detection (fail-open).
   */
  blockedEscalatedAtMs?: number | null;
  /** Suppression window for the blocked hold (ms); the re-escalation interval. */
  blockedHoldMs?: number;
  /**
   * True when the task's newest transition cause is a blocked-task-escalation
   * cause (BLOCKED_ESCALATION_CAUSES). The dedicated pipeline already notified
   * a human and re-notifies every 4h, so a second `self-incident:stagnation`
   * finding is a duplicate (#978). Only honoured for status=blocked;
   * `null`/`undefined` leaves the task subject to detection (fail-open).
   */
  blockedEscalated?: boolean | null;
  /**
   * True when `taskStatus === 'blocked'` AND the task's theme is armed
   * (`ThemeAutoRun.enabled === true && status === 'running'`) — the existing
   * blocked-task pipeline (`workflow-reconciler-blocked.ts`'s
   * `findBlockedCandidates`) already owns retry/escalation for exactly this
   * condition (task 977), so re-flagging it here as stagnation would just
   * duplicate a pipeline that is actively working the task. Must stay
   * condition-for-condition identical to `findBlockedCandidates`' armed
   * query — a drift silences detection for tasks the blocked pipeline does
   * NOT actually manage (e.g. `themeId: null`, paused themes).
   * `null`/`undefined` (unresolved) leaves the task subject to detection —
   * mirrors the other optional gates' fail-open convention.
   */
  blockedRetryPipelineArmed?: boolean | null;
  /**
   * True when `Task.haltReason` is set or the operator opted the task out of
   * auto-run (`Task.autoRunExcluded`) — the selector never picks such a task, so
   * its absence of execution/queue is deliberate. Mirrors TriStateDesyncInput.
   * `null`/`undefined` leaves the task subject to detection (fail-open).
   */
  taskHalted?: boolean | null;
  autoRunExcluded?: boolean | null;
  /** Newest transition cause + newest plan-hold time (#1205); unresolved = fail-open. */
  latestTransitionCause?: string | null;
  latestPlanHoldAtMs?: number | null;
  nowMs: number;
  thresholdMs?: number;
}

/**
 * Whether the newest blocked escalation notice is still fresh: window = re-notify interval
 * + 30min slack; past it the notifier is presumed dead, so detection resumes (#980).
 *
 * @param latestEscalationAtMs - Newest blocked_(re)escalated time, null when none/unknown. / 最新通知時刻
 * @param nowMs - Current time (ms). / 現在時刻
 * @returns True when a notice landed inside the window. / 窓内なら true
 */
export function isBlockedEscalationRecent(
  latestEscalationAtMs: number | null,
  nowMs: number,
): boolean {
  return (
    latestEscalationAtMs != null &&
    nowMs - latestEscalationAtMs < BLOCKED_REESCALATION_INTERVAL_MS + 30 * 60_000
  );
}

/**
 * Detects a stagnant non-terminal task: no activity for the threshold while no
 * agent is running, nothing is queued, and no legitimate wait state applies.
 * Only in-flight tasks qualify — a pure todo backlog item that never started
 * (workflowStatus draft/null, no execution ever, not in-progress) is skipped.
 * Deliberately withdrawn tasks are excluded (#875, see StagnationInput.manuallyWithdrawn).
 *
 * @param input - Task snapshot (see StagnationInput). / タスクの現在状態スナップショット
 * @returns Staleness in ms when stagnant, otherwise null. / 停滞時はstaleMs、非停滞はnull
 */
export function detectStagnation(input: StagnationInput): { staleMs: number } | null {
  if (TERMINAL_TASK_STATUSES.has(input.taskStatus)) return null;
  if (input.workflowStatus === 'completed' || input.workflowStatus === 'awaiting_question') {
    return null;
  }
  // Task cannot structurally dispatch (workflow disabled / non-development
  // theme / theme auto-run disabled) → the wait is legitimate and
  // indefinite, not stagnation (#860).
  if (input.isWorkflowManaged === false) return null;
  // Deliberately withdrawn via stop-execution({withdraw:true}) (#875) — the
  // operator has already decided not to resume this task; repeating the
  // same finding every watch pass forever is noise, not signal.
  if (input.manuallyWithdrawn) return null;
  // NOTE: halted / auto-run-excluded tasks are never selected by the auto-run
  // selector, so "no execution, no queue" is the intended state, not stagnation
  // (symmetric with detectTriStateDesync's gates).
  if (input.taskHalted || input.autoRunExcluded) return null;
  // NOTE: blocked tasks are re-notified every 4h but the stagnation threshold is 30min, so
  // a notified blocked hold re-tripped detection 30min after every notice (#980).
  if (input.taskStatus === 'blocked' && input.blockedEscalationRecent) return null;
  // Theme is actively dispatching a different task — this one is a normal
  // backlog wait under AUTO_RUN_GLOBAL_MAX_CONCURRENCY=1, not stagnation (#969).
  if (input.themeAutoRunBusyWithOtherTask) return null;
  // Escalated blocked hold (#979): waiting on a human after a notice is legitimate
  // until the re-escalation interval lapses; past it, escalation itself has
  // stopped and the task is a genuine orphan again.
  if (
    input.taskStatus === 'blocked' &&
    input.blockedEscalatedAtMs != null &&
    input.blockedHoldMs != null &&
    input.nowMs - input.blockedEscalatedAtMs < input.blockedHoldMs
  ) {
    return null;
  }
  // Blocked and already escalated to a human by the dedicated pipeline (#978).
  if (input.blockedEscalated && input.taskStatus === 'blocked') return null;
  // A blocked task in an armed theme is already owned by the blocked-task
  // retry/escalation pipeline (task 977) — do not duplicate its detection.
  if (input.taskStatus === 'blocked' && input.blockedRetryPipelineArmed) return null;
  // NOTE: null must count as not-started — `null !== 'draft'` alone would
  // misclassify a workflowStatus-less task as advanced.
  const isInFlight =
    (input.workflowStatus !== null && input.workflowStatus !== 'draft') ||
    input.hasAnyExecution ||
    input.taskStatus === 'in-progress';
  if (!isInFlight) return null;
  if (input.hasLiveExecution || input.hasActiveQueueItem) return null;
  const staleMs = input.nowMs - input.lastActivityAtMs;
  if (staleMs < (input.thresholdMs ?? STAGNATION_THRESHOLD_MS)) return null;
  // Fresh forbidden-change plan hold = a human-override wait, already notified (#1205).
  if (isPlanHoldAwaitingHuman(input)) return null;
  return { staleMs };
}
