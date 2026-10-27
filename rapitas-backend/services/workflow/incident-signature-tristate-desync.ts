/**
 * incident-signature-tristate-desync
 *
 * The tri-state desync detector: a snapshot where Task, AgentSession and
 * AgentExecution disagree. Two patterns —
 *   A `session_failed_execution_active`  terminal session, still-live execution
 *   B `todo_status_workflow_advanced`    status reverted to todo, workflow ahead
 * Pure: no DB, no clock beyond the supplied `nowMs`.
 *
 * Split out of incident-signature-detectors.ts (line limit), which re-exports
 * everything here — the same split already done for the repeat-loop (task 855)
 * and unanswered-question (task 1003) detectors. Which suppression gate each
 * pattern honours, and why they differ, is argued in
 * incident-signature-detectors.suppression-invariants.test.ts.
 */
import { ACTIVE_EXEC } from './workflow-reconciler-requeue';
import { TERMINAL_TASK_STATUSES } from './incident-signature-unanswered-question';

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

/** Transition causes that re-queue a task on purpose (shared with queue-failure-mark-policy). */
export const RECOVERY_REQUEUE_CAUSES: ReadonlySet<string> = new Set([
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
  /**
   * True when a queued/running/waiting_approval WorkflowQueueItem exists for
   * the task (same signal detectStagnation already uses via
   * StagnationInput.hasActiveQueueItem). Pattern B's `todo`×advanced-
   * `workflowStatus` shape is a normal pre-dispatch wait while the task sits
   * in the queue, not a stuck/corrupted state — any transition cause NOT in
   * RECOVERY_REQUEUE_CAUSES (e.g. auto_approve_plan) fired Pattern B on a
   * queued task (#769). `undefined` (unresolved) is treated as false —
   * mirrors themeAutoRunEnabled's fail-open default in the opposite
   * direction: an unknown queue state must never silently suppress detection.
   */
  hasActiveQueueItem?: boolean;
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
 * auto-run (`autoRunExcluded`) — EXCEPT ALSO when the task has an active queue item
 * (`hasActiveQueueItem === true`), where the shape is a normal pre-dispatch
 * wait regardless of transition cause (#769, see
 * TriStateDesyncInput.hasActiveQueueItem).
 *
 * @param input - Cross-entity state snapshot. / 三面の状態スナップショット
 * @returns Detected pattern + human-readable summary, or null. / 検出結果またはnull
 */
export function detectTriStateDesync(
  input: TriStateDesyncInput,
): { kind: TriStateDesyncKind; detail: string } | null {
  // Symmetric with detectStagnation's identical first line; added for Pattern
  // A, which read no task status at all. Why each gate below is or is not here
  // is argued in incident-signature-detectors.suppression-invariants.test.
  if (TERMINAL_TASK_STATUSES.has(input.taskStatus)) return null;
  if (
    input.latestSessionStatus !== null &&
    FAILED_SESSION_STATUSES.has(input.latestSessionStatus) &&
    input.latestExecutionStatus !== null &&
    ACTIVE_EXECUTION_STATUSES.has(input.latestExecutionStatus)
  ) {
    if (isWithinPatternASettle(input)) return null;
    // A deliberately parked task does not need a finding. Pattern B has gated
    // on these since #875 / #1003; Pattern A never did, so an operator who
    // halted, excluded or withdrew a task still got one filed against it. An
    // exhaustive enumeration (2026-10-28) found 32 distinct shapes of that;
    // none had been reached in production.
    //
    // Two of Pattern B's gates are deliberately NOT here:
    //   themeAutoRunEnabled === false — pattern-b-grace.test pins "does NOT
    //     let a disabled theme auto-run suppress pattern A" (#715). A pause
    //     explains Pattern B's shape, because the pause mechanism creates it;
    //     it does not explain a session/execution mismatch, which predates the
    //     pause and still needs settling.
    //   themeAutoRunBusyWithOtherTask — about dispatch order; says nothing
    //     about a stale execution row (see its own doc comment).
    //
    // FIXME: by that same argument taskHalted and autoRunExcluded do not
    // explain the mismatch either — only manuallyWithdrawn does, since
    // stopping an execution is what leaves a session terminal with its
    // execution unsettled. Kept at the operator's instruction; revisit if
    // Pattern A goes quiet on a genuinely stuck row.
    if (input.taskHalted) return null;
    if (input.autoRunExcluded) return null;
    if (input.manuallyWithdrawn) return null;
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
    // Queued for dispatch → the shape is a normal pre-dispatch wait, not a
    // stuck/corrupted state, regardless of the transition cause (#769).
    if (input.hasActiveQueueItem === true) return null;
    return {
      kind: 'todo_status_workflow_advanced',
      detail: `task.status=todo のまま workflowStatus が前進済み(${input.workflowStatus})`,
    };
  }
  return null;
}
