/**
 * incident-signature-detectors
 *
 * Pure detection predicates for the self-incident watcher: stagnation of a
 * non-terminal task, tri-state desync across Task/AgentSession/AgentExecution,
 * a same-cause repeat loop, and an intake question left unanswered too long.
 * DB-independent by design — every input is a
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

/**
 * Minimum same-cause invariantViolation transitions within the window to count
 * as a loop (default 2, lower than REPEAT_LOOP_MIN_COUNT). An invariantViolation
 * is the system itself flagging a contract breach, a strong signal that does not
 * need the general threshold's forgiveness-budget churn allowance (task 673: 2
 * `verify_pr_not_created` invariantViolations 70s apart went undetected under
 * the default minCount=3/window=60m).
 */
export const INVARIANT_REPEAT_LOOP_MIN_COUNT =
  parseInt(process.env.RAPITAS_INCIDENT_INVARIANT_LOOP_MIN_COUNT ?? '', 10) || 2;

/**
 * Grace period after a deliberate recovery transition during which the
 * `todo × advanced-workflow` shape is EXPECTED, not anomalous (default 30m).
 * Rationale (#636): requeueOrphanTasks resets status to 'todo' while keeping
 * workflowStatus on purpose so auto-run resumes mid-workflow — the watcher
 * fired Pattern B 59s later and filed the reconciler's own heal as a
 * high-severity bug. 30m matches STAGNATION_THRESHOLD_MS: past that point a
 * still-undispatched task is caught by detectStagnation anyway, so shrinking
 * Pattern B here does not open a detection gap.
 */
export const DESYNC_RECOVERY_SETTLE_MS =
  parseInt(process.env.RAPITAS_INCIDENT_DESYNC_SETTLE_MS ?? '', 10) || 30 * 60 * 1000;

/**
 * Transition causes that DELIBERATELY produce `task.status='todo'` with an
 * advanced workflowStatus: reconciler_requeue keeps workflowStatus so the
 * resume mapping re-enters at the right phase (workflow-reconciler-requeue),
 * artifact_reuse_fastforward advances workflowStatus of a still-todo task
 * before dispatch (artifact-reuse-reconciler), and task_retried resets
 * status to 'todo' while rolling workflowStatus back to a resume point —
 * see `routes/tasks/task-retry-handler.ts` `resolveRollbackTarget()`
 * (rolls verify_done back to plan_approved/research_done) and its caller
 * `retryTask()`, which writes `{ status: 'todo', workflowStatus: rolledBackTo }`
 * in the same `prisma.task.update` call. This is the same shape as the other
 * two causes, triggered by a manual retry instead of the reconciler (#680,
 * task #672 filed 139s after a task_retried transition to research_done;
 * task #672 subsequently self-resolved to status=done/workflowStatus=completed
 * via normal dispatch with no data repair applied, confirming the shape was
 * transient and self-healing rather than a corrupted state). blocked_auto_retry
 * is NOT here — it resets workflowStatus to 'draft', which Pattern B never
 * matches.
 *
 * agent_lifecycle_shutdown_revert / manual_execution_stop_revert /
 * stale_execution_recovery_revert (task 709): three more code paths revert
 * `task.status` to 'todo' without changing `workflowStatus` — backend
 * shutdown (`lifecycle-manager.ts` `saveAgentState`), a manual stop
 * (`stop-route.ts`), and stale-execution recovery
 * (`stale-recovery-helpers.ts` `updateAffectedTasks`). Before task 709 none
 * of the three recorded a `WorkflowTransition`, so `isWithinRecoveryGrace`
 * had no row to find and Pattern B fired immediately on a shape those paths
 * create on purpose (task #602). Recording these three causes closes that
 * gap the same way `task_retried` already does.
 */
const RECOVERY_REQUEUE_CAUSES = new Set([
  'reconciler_requeue',
  'artifact_reuse_fastforward',
  'task_retried',
  'agent_lifecycle_shutdown_revert',
  'manual_execution_stop_revert',
  'stale_execution_recovery_revert',
]);

/**
 * Wait time after which an unanswered intake question counts as stale (default
 * 24h). Rationale: tasks #578/#579 sat in awaiting_question for 4 days
 * (raised 2026-08-13T13:48:35Z, found 2026-08-17) with zero notifications —
 * 24h turns that into a daily reminder while staying quiet for same-day answers.
 */
export const UNANSWERED_QUESTION_THRESHOLD_MS =
  parseInt(process.env.RAPITAS_INCIDENT_UNANSWERED_MS ?? '', 10) || 24 * 60 * 60 * 1000;

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
  /** True when any AgentExecution exists for the task, regardless of status. */
  hasAnyExecution: boolean;
  /** True when a queued/running/waiting_approval WorkflowQueueItem exists. */
  hasActiveQueueItem: boolean;
  nowMs: number;
  thresholdMs?: number;
}

/**
 * Detects a stagnant non-terminal task: no activity for the threshold while no
 * agent is running, nothing is queued, and no legitimate wait state applies.
 * Only in-flight tasks qualify — a pure todo backlog item that never started
 * (workflowStatus draft/null, no execution ever, not in-progress) is skipped.
 *
 * @param input - Task snapshot (see StagnationInput). / タスクの現在状態スナップショット
 * @returns Staleness in ms when stagnant, otherwise null. / 停滞時はstaleMs、非停滞はnull
 */
export function detectStagnation(input: StagnationInput): { staleMs: number } | null {
  if (TERMINAL_TASK_STATUSES.has(input.taskStatus)) return null;
  if (input.workflowStatus === 'completed' || input.workflowStatus === 'awaiting_question') {
    return null;
  }
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
  /** Current time (ms) — the recovery grace guard needs it to age the transition. */
  nowMs?: number;
  /** Recovery grace override (default DESYNC_RECOVERY_SETTLE_MS). */
  settleMs?: number;
}

/** Which desync pattern was detected. */
export type TriStateDesyncKind =
  | 'session_failed_execution_active'
  | 'todo_status_workflow_advanced';

/**
 * True when the newest transition is a deliberate recovery that has not yet
 * settled — Pattern B must not fire on a state the reconciler just created on
 * purpose (#636). Requires cause AND both timestamps: with incomplete inputs
 * the guard stays off so detection sensitivity never silently degrades.
 */
function isWithinRecoveryGrace(input: TriStateDesyncInput): boolean {
  if (input.latestTransitionCause == null) return false;
  if (!RECOVERY_REQUEUE_CAUSES.has(input.latestTransitionCause)) return false;
  if (input.latestTransitionAtMs == null || input.nowMs === undefined) return false;
  return input.nowMs - input.latestTransitionAtMs < (input.settleMs ?? DESYNC_RECOVERY_SETTLE_MS);
}

/**
 * Detects a Task/AgentSession/AgentExecution state contradiction. Pattern A
 * (session terminally failed but its execution still active) is checked first
 * and wins when both apply — the session/execution anomaly is the more urgent
 * signal. Pattern B: task.status still 'todo' while the workflow advanced —
 * EXCEPT within the recovery grace window after a cause in
 * RECOVERY_REQUEUE_CAUSES (reconciler_requeue / artifact_reuse_fastforward /
 * task_retried), which produces exactly that shape by design (see
 * isWithinRecoveryGrace; past the window detectStagnation covers a
 * still-undispatched task, so the detection net keeps a backstop).
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
    if (isWithinRecoveryGrace(input)) return null;
    return {
      kind: 'todo_status_workflow_advanced',
      detail: `task.status=todo のまま workflowStatus が前進済み(${input.workflowStatus})`,
    };
  }
  return null;
}

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

/** One workflow transition reduced to what the repeat-loop detector needs. */
export interface RepeatLoopTransition {
  cause: string;
  createdAtMs: number;
  /** Who caused the transition (TransitionActor value, e.g. 'system'/'user'). */
  actor: string;
  /**
   * True when this transition was recorded as an invariant violation (system
   * self-detected contract breach). Feeds an independent, lower-threshold
   * detection path — see {@link INVARIANT_REPEAT_LOOP_MIN_COUNT}. Optional for
   * backward compatibility with existing callers that don't set it (treated as
   * false / not counted).
   */
  invariantViolation?: boolean;
}

/**
 * Cause prefix for a normal phase handoff (e.g. `phase_completed:implementer`).
 * Only excluded from repeat-loop aggregation when a repair-bounce cause is
 * also present in the window — see the guard below in
 * {@link detectRepeatLoop} for why.
 */
const PHASE_COMPLETED_CAUSE_PREFIX = 'phase_completed:';

/**
 * Causes that indicate a self-repair bounce (verify/CI sent a phase back for
 * another attempt). Their presence in the window is what tells
 * {@link detectRepeatLoop} that repeated `phase_completed:*` causes are a
 * healthy repair cycle rather than an anomaly — see the guard below.
 */
const REPAIR_BOUNCE_CAUSES = new Set(['verify_repair', 'ci_repair']);

/**
 * Detects a same-cause repeat loop: the same transition cause firing at least
 * `minCount` times within the trailing window. Ties between causes with equal
 * counts break deterministically by cause name (localeCompare ascending).
 * Transitions with actor='user' are excluded — operator manual recovery is
 * intervention, not a loop (actor-based, so any future manual cause is covered).
 * Causes prefixed `phase_completed:` are forgiven, but only when a preceding
 * `verify_repair`/`ci_repair` bounce actually re-authorizes that specific
 * firing: transitions are walked in chronological order with a running
 * "forgiveness budget" that starts at 1 (the initial pass, granted only if
 * the window contains at least one bounce at all) and gains 1 for every
 * bounce encountered so far. Each `phase_completed:*` firing spends one unit
 * of budget if available; if the budget is already spent, that firing is a
 * genuine anomaly and is counted (e.g. #607, task 614: 1 implement + 2
 * verify_repair bounces, each bounce preceding its re-implement, fully
 * explains 3 firings and is not reported as a loop; the same mechanism also
 * explains #616's 1 implement + 2 verify_repair bounces — see
 * incident-signature-detectors.repeat-loop-t616.test.ts for the exact
 * replayed transition window). Requiring the bounce to
 * chronologically precede the firing it forgives (rather than just summing
 * bounce counts anywhere in the window) closes a gap where phase_completed
 * churn front-loaded before any bounce — which a same-window bounce cannot
 * causally explain — would otherwise be waved through by coincidental later
 * bounces of a *different* cause (verify_repair and ci_repair combined). A
 * `phase_completed:*` repetition with zero bounces anywhere in the window is
 * never forgiven at all.
 * A terminal taskStatus (see TERMINAL_TASK_STATUSES) short-circuits to null —
 * a task that has already finished is not "looping" even if it churned through
 * several retry cycles on the way there (mirrors detectStagnation's guard;
 * caught a false positive on #607, which completed 12s before the report).
 *
 * @param input.transitions - Task transitions (any order). / 対象タスクの遷移一覧
 * @param input.nowMs - Current time (ms). / 現在時刻
 * @param input.taskStatus - Current task status; terminal statuses skip detection (undefined = not checked, for backward compatibility). / タスクの現在ステータス（終端状態は検出をスキップ）
 * @param input.windowMs - Window size (default 60m). / 集計窓
 * @param input.minCount - Detection threshold (default 3). / 検出しきい値
 * @param input.invariantMinCount - Detection threshold for invariantViolation-flagged transitions only (default 2, see {@link INVARIANT_REPEAT_LOOP_MIN_COUNT}). / invariantViolation付き遷移専用のしきい値
 * @returns The dominant looping cause + count, or null. / 最多ループcauseまたはnull
 */
export function detectRepeatLoop(input: {
  transitions: RepeatLoopTransition[];
  nowMs: number;
  taskStatus?: string;
  windowMs?: number;
  minCount?: number;
  invariantMinCount?: number;
}): { cause: string; count: number } | null {
  if (input.taskStatus !== undefined && TERMINAL_TASK_STATUSES.has(input.taskStatus)) return null;
  const windowMs = input.windowMs ?? REPEAT_LOOP_WINDOW_MS;
  const minCount = input.minCount ?? REPEAT_LOOP_MIN_COUNT;
  const invariantMinCount = input.invariantMinCount ?? INVARIANT_REPEAT_LOOP_MIN_COUNT;
  const windowStart = input.nowMs - windowMs;

  const windowed = input.transitions
    .filter(
      (t) => t.actor !== 'user' && t.createdAtMs >= windowStart && t.createdAtMs <= input.nowMs,
    )
    .sort((a, b) => a.createdAtMs - b.createdAtMs);

  let bounceTotal = 0;
  for (const t of windowed) {
    if (REPAIR_BOUNCE_CAUSES.has(t.cause)) bounceTotal += 1;
  }

  let forgivenessBudget = bounceTotal > 0 ? 1 : 0;
  const counts = new Map<string, number>();
  for (const t of windowed) {
    if (REPAIR_BOUNCE_CAUSES.has(t.cause)) {
      forgivenessBudget += 1;
      counts.set(t.cause, (counts.get(t.cause) ?? 0) + 1);
      continue;
    }
    if (t.cause.startsWith(PHASE_COMPLETED_CAUSE_PREFIX) && forgivenessBudget > 0) {
      forgivenessBudget -= 1;
      continue;
    }
    counts.set(t.cause, (counts.get(t.cause) ?? 0) + 1);
  }

  // Independent invariantViolation counting path (task 673): raw per-cause
  // counts of ONLY the transitions the system itself flagged as an invariant
  // breach, bypassing forgivenessBudget entirely — a repeat verify_repair/
  // ci_repair bounce should not "spend" budget that excuses a genuine
  // contract violation from detection.
  const invariantCounts = new Map<string, number>();
  for (const t of windowed) {
    if (t.invariantViolation === true) {
      invariantCounts.set(t.cause, (invariantCounts.get(t.cause) ?? 0) + 1);
    }
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
  for (const [cause, count] of invariantCounts) {
    if (count < invariantMinCount) continue;
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
