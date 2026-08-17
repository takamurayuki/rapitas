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

/** Snapshot of one task used by the unanswered-question detector. */
export interface UnansweredQuestionInput {
  workflowStatus: string | null;
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
 * explains 3 firings and is not reported as a loop). Requiring the bounce to
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
 * @returns The dominant looping cause + count, or null. / 最多ループcauseまたはnull
 */
export function detectRepeatLoop(input: {
  transitions: RepeatLoopTransition[];
  nowMs: number;
  taskStatus?: string;
  windowMs?: number;
  minCount?: number;
}): { cause: string; count: number } | null {
  if (input.taskStatus !== undefined && TERMINAL_TASK_STATUSES.has(input.taskStatus)) return null;
  const windowMs = input.windowMs ?? REPEAT_LOOP_WINDOW_MS;
  const minCount = input.minCount ?? REPEAT_LOOP_MIN_COUNT;
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
