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
import { ACTIVE_EXEC } from './workflow-reconciler-requeue';
import { BLOCKED_REESCALATION_INTERVAL_MS } from './blocked-task-policy';
import { TERMINAL_TASK_STATUSES } from './incident-signature-unanswered-question';
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

/** Idle time after which a non-terminal task counts as stagnant (default 30m). */
export const STAGNATION_THRESHOLD_MS =
  parseInt(process.env.RAPITAS_INCIDENT_STAGNATION_MS ?? '', 10) || 30 * 60 * 1000;

/**
 * Grace period after a deliberate recovery transition during which the `todo × advanced-workflow`
 * shape is EXPECTED, not anomalous (default 30m). Rationale (#636): requeueOrphanTasks resets
 * status to 'todo' while keeping workflowStatus on purpose so auto-run resumes mid-workflow —
 * the watcher fired Pattern B 59s later and filed the reconciler's own heal as a high-severity
 * bug. 30m matches STAGNATION_THRESHOLD_MS: past that a still-undispatched task is caught by
 * detectStagnation anyway, so shrinking Pattern B here does not open a detection gap.
 */
export const DESYNC_RECOVERY_SETTLE_MS =
  parseInt(process.env.RAPITAS_INCIDENT_DESYNC_SETTLE_MS ?? '', 10) || 30 * 60 * 1000;

/**
 * Grace period after a failed session's own last update during which Pattern A
 * (`session_failed_execution_active`) is EXPECTED, not anomalous (default 130s).
 * Rationale (#718): the verify post-save pipeline marks a session failed while its own
 * execution is still running the pipeline (jury ~120s + commit/PR); DESYNC_RECOVERY_SETTLE_MS's
 * 30m is sized for the longer-lived Pattern B and would delay hung-execution detection here.
 */
export const PATTERN_A_SETTLE_MS =
  parseInt(process.env.RAPITAS_INCIDENT_PATTERN_A_SETTLE_MS ?? '', 10) || 130_000;

/**
 * Transition causes that DELIBERATELY produce `task.status='todo'` with an
 * advanced workflowStatus: `reconciler_requeue` keeps workflowStatus so resume
 * re-enters at the right phase (workflow-reconciler-requeue);
 * `artifact_reuse_fastforward` advances workflowStatus of a still-todo task
 * before dispatch (artifact-reuse-reconciler); `task_retried` resets status to
 * 'todo' while rolling workflowStatus back to a resume point — see
 * `routes/tasks/task-retry-handler.ts` `resolveRollbackTarget()`/`retryTask()`
 * (#680, task #672 filed 139s after a `task_retried` to research_done, then
 * self-resolved to done/completed via normal dispatch with no data repair,
 * confirming the shape is transient/self-healing). `blocked_auto_retry` is NOT
 * here — it resets workflowStatus to 'draft', which Pattern B never matches.
 * `agent_lifecycle_shutdown_revert` / `manual_execution_stop_revert` /
 * `stale_execution_recovery_revert` (task 709): three more paths revert
 * `task.status` to 'todo' without touching `workflowStatus` — backend
 * shutdown (`lifecycle-manager.ts`), a manual stop (`stop-route.ts`), and
 * stale-execution recovery (`stale-recovery-helpers.ts` `updateAffectedTasks`).
 * Before task 709 none recorded a `WorkflowTransition`, so
 * `isWithinRecoveryGrace` had no row to find and Pattern B fired immediately
 * on a shape these paths create on purpose (task #602). `workflow_queue_
 * enqueue_failed` (786) / `auto_run_stop_revert` (830): ditto, via enqueue() / `stopThemeExecutionImpl`.
 * `manual_execution_stop_withdraw` (#875): stop-execution({withdraw:true}) —
 * same shape immediately after the call, but unlike the other causes here it
 * is also PERMANENTLY excluded via `manuallyWithdrawn` once the grace window
 * passes (see detectStagnation/detectTriStateDesync).
 */
export const MANUAL_STOP_WITHDRAW_CAUSE = 'manual_execution_stop_withdraw';

/**
 * Transition causes written by blocked-task-escalation (first notice and the
 * 4h re-notice). Duplicated as literals so this pure module stays free of the
 * escalation module's DB imports — keep in sync with blocked-task-escalation.ts.
 */
export const BLOCKED_ESCALATION_CAUSES: ReadonlySet<string> = new Set([
  'blocked_escalated',
  'blocked_reescalated',
]);

const RECOVERY_REQUEUE_CAUSES = new Set([
  'reconciler_requeue',
  'artifact_reuse_fastforward',
  'task_retried',
  'agent_lifecycle_shutdown_revert',
  'manual_execution_stop_revert',
  'stale_execution_recovery_revert',
  'workflow_queue_enqueue_failed',
  'auto_run_stop_revert',
  MANUAL_STOP_WITHDRAW_CAUSE,
]);

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
  /** Cause of the task's newest workflow transition (null/undefined = unknown). */
  latestTransitionCause?: string | null;
  /** createdAt of that transition, epoch ms (null/undefined = unknown). */
  latestTransitionAtMs?: number | null;
  /** Recent transitions to scan for a recovery cause; empty/omitted falls back to latestTransitionCause/latestTransitionAtMs (#775). */
  recentTransitions?: { cause: string; createdAtMs: number }[];
  /** updatedAt of that AgentSession, epoch ms — feeds only the Pattern A settle-window guard. */
  latestSessionUpdatedAtMs?: number | null;
  /**
   * Whether the task's theme has auto-run enabled (`ThemeAutoRun.enabled`).
   * `false` makes Pattern B's `todo` × advanced-`workflowStatus` shape a
   * legitimate indefinite wait rather than an anomaly: a retry against a
   * paused theme resets `status` to 'todo' to resume once dispatched, but a
   * paused theme never dispatches, so the shape outlives
   * DESYNC_RECOVERY_SETTLE_MS and Pattern B fired forever (task #715, e.g.
   * tasks #602/#646/#647, themeId=25). `null`/`undefined` (unresolved) is
   * treated as enabled — mirrors isWithinRecoveryGrace: incomplete input must
   * never silently widen suppression.
   */
  themeAutoRunEnabled?: boolean | null;
  /**
   * True when the task's newest relevant transition cause is
   * MANUAL_STOP_WITHDRAW_CAUSE — the operator explicitly withdrew this task
   * via stop-execution({withdraw:true}) and decided not to resume it (#875).
   * `null`/`undefined` (unresolved) leaves the task subject to detection —
   * mirrors themeAutoRunEnabled's fail-open convention.
   */
  manuallyWithdrawn?: boolean | null;
  /**
   * True when the task's theme has auto-run `status === 'running'` and
   * `currentTaskId` is a DIFFERENT task — see StagnationInput.
   * themeAutoRunBusyWithOtherTask for the full rationale (#969). Applies only
   * to Pattern B (todo × advanced workflowStatus); Pattern A is unrelated to
   * theme dispatch state and never reads this field.
   */
  themeAutoRunBusyWithOtherTask?: boolean | null;
  /**
   * True when the task carries a `Task.haltReason` (iteration-budget halt). A
   * halt deliberately leaves task.status/workflowStatus untouched, so todo ×
   * advanced is the expected resting shape until an operator resumes it, not
   * a desync (#1003). Applies only to Pattern B.
   */
  taskHalted?: boolean | null;
  /**
   * True when the operator opted the task out of auto-run (`Task.autoRunExcluded`,
   * e.g. via theme stop-execution). Selection never dispatches it, so todo ×
   * advanced is an indefinite, legitimate wait — the actual shape of #907
   * (#1003). Applies only to Pattern B.
   */
  autoRunExcluded?: boolean | null;
  /** Current time (ms) — the recovery grace guard needs it to age the transition. */
  nowMs?: number;
  /** Pattern B recovery grace override (default DESYNC_RECOVERY_SETTLE_MS). */
  settleMs?: number;
  /** Pattern A settle-window override (default PATTERN_A_SETTLE_MS). */
  patternASettleMs?: number;
}

/** Which desync pattern was detected. */
export type TriStateDesyncKind =
  | 'session_failed_execution_active'
  | 'todo_status_workflow_advanced';

/**
 * True when a recovery cause fired within the grace window (#636); scans
 * `recentTransitions` if given, else falls back to the single
 * `latestTransitionCause`/`latestTransitionAtMs` pair (#775).
 */
function isWithinRecoveryGrace(input: TriStateDesyncInput): boolean {
  if (input.nowMs === undefined) return false;
  const nowMs = input.nowMs;
  const settleMs = input.settleMs ?? DESYNC_RECOVERY_SETTLE_MS;
  const list = input.recentTransitions?.length
    ? input.recentTransitions
    : input.latestTransitionCause != null && input.latestTransitionAtMs != null
      ? [{ cause: input.latestTransitionCause, createdAtMs: input.latestTransitionAtMs }]
      : [];
  return list.some((t) => RECOVERY_REQUEUE_CAUSES.has(t.cause) && nowMs - t.createdAtMs < settleMs);
}

/**
 * True when the session's own last update is within the Pattern A settle
 * window (#718). Requires BOTH timestamps — with either missing the guard
 * stays off, so detection sensitivity never silently degrades (mirrors
 * isWithinRecoveryGrace).
 */
function isWithinPatternASettle(input: TriStateDesyncInput): boolean {
  if (input.latestSessionUpdatedAtMs == null || input.nowMs === undefined) return false;
  return (
    input.nowMs - input.latestSessionUpdatedAtMs < (input.patternASettleMs ?? PATTERN_A_SETTLE_MS)
  );
}

/**
 * Detects a Task/AgentSession/AgentExecution state contradiction. Pattern A
 * (session terminally failed but its execution still active) is checked first
 * and wins when both apply — the session/execution anomaly is the more urgent
 * signal — EXCEPT within PATTERN_A_SETTLE_MS of the session's own last update
 * (see isWithinPatternASettle, #718). Pattern B: task.status still 'todo'
 * while the workflow advanced —
 * EXCEPT within the recovery grace window after a cause in
 * RECOVERY_REQUEUE_CAUSES (reconciler_requeue / artifact_reuse_fastforward /
 * task_retried), which produces exactly that shape by design (see
 * isWithinRecoveryGrace; past the window detectStagnation covers a
 * still-undispatched task, so the detection net keeps a backstop) —
 * EXCEPT ALSO when the task's theme has auto-run disabled
 * (`themeAutoRunEnabled === false`), where the shape is an indefinite,
 * legitimate wait rather than a transient one (task #715, see
 * TriStateDesyncInput.themeAutoRunEnabled) — EXCEPT ALSO when the task was
 * deliberately withdrawn (#875, see TriStateDesyncInput.manuallyWithdrawn) —
 * EXCEPT ALSO when the theme is busy dispatching a different task (#969, see
 * TriStateDesyncInput.themeAutoRunBusyWithOtherTask) — EXCEPT ALSO when the task is
 * halted by the iteration budget (#1003, see TriStateDesyncInput.taskHalted) or opted out of
 * auto-run (`autoRunExcluded`).
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
    if (isWithinPatternASettle(input)) return null;
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
    if (isWithinRecoveryGrace(input)) return null;
    // Theme auto-run disabled → nothing will ever dispatch this task, so the
    // wait is legitimate and indefinite, not a stuck/corrupted state (#715).
    if (input.themeAutoRunEnabled === false) return null;
    // Deliberately withdrawn via stop-execution({withdraw:true}) (#875) —
    // same rationale as detectStagnation's identically-named gate.
    if (input.manuallyWithdrawn) return null;
    // Theme is actively dispatching a different task — normal backlog wait,
    // not a desync (#969, mirrors detectStagnation's identically-named gate).
    if (input.themeAutoRunBusyWithOtherTask) return null;
    // Deliberately halted by the iteration budget (#1003) — legitimate wait for an operator.
    if (input.taskHalted) return null;
    // Operator opted out of auto-run (#1003) — nothing will dispatch it by design.
    if (input.autoRunExcluded) return null;
    return {
      kind: 'todo_status_workflow_advanced',
      detail: `task.status=todo のまま workflowStatus が前進済み(${input.workflowStatus})`,
    };
  }
  return null;
}
