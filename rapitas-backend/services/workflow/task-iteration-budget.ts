/**
 * task-iteration-budget
 *
 * Single task-wide halt judgement combining the four previously-separate
 * repeat axes (time / cost / attempts / same-cause repeat) plus a
 * no-progress fallback, per task 881. Existing modules keep their current
 * responsibilities unchanged — this module only ADDS a stop decision on top
 * of their outputs (see plan.md §重複・置換範囲マッピング):
 *   - cost figures come from task-budget.ts's getTaskSpendUsd (reused as-is)
 *   - same-cause repeat comes from incident-signature-repeat-loop.ts's
 *     detectRepeatLoop (reused as-is, forgiveness budget included)
 *   - the window-reset boundary follows the same event-driven pattern as
 *     verify-self-repair-budget.ts's resolveRepairWindowStart
 *
 * `resolveIterationBudgetState` is a pure predicate (DB-independent, unit
 * testable) mirroring detectStagnation's input-snapshot style.
 * `resolveIterationBudgetForTask` is the DB-wiring async assembler — it owns
 * fail-open behavior (a read failure never halts a task) and escalates via
 * an error log plus a deduplicated concern-backlog filing once 3 consecutive
 * read failures occur for the same task.
 */

import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { getTaskSpendUsd } from './task-budget';
import { detectRepeatLoop, REPEAT_LOOP_WINDOW_MS } from './incident-signature-repeat-loop';
import { countNonAdvancingTransitions } from './task-iteration-budget-status';
import { submitConcern } from '../memory/concern-backlog-service';
import type {
  HaltReason,
  IterationBudgetState,
  ResumeCondition,
} from './task-iteration-budget.types';

const log = createLogger('task-iteration-budget');

/** WorkflowTransition causes that reset the iteration window (fresh slate). */
const WINDOW_RESET_CAUSES = ['task_retried', 'question_resolved', 'plan_invalid_replan'];

/**
 * Transition causes written by the STOP side (this budget's own halt, the
 * hang backstop) rather than by the task's work. They are excluded from the
 * repeat-loop and status-repeat inputs: a halt records a same-status
 * transition every tick it fires, so counting it made the first halt prove
 * its own "repeat cause" forever (task 984/985, 2026-09-20: 51 self-repeats).
 */
const HALT_SIDE_CAUSES = new Set(['iteration_budget_halted', 'auto_run_hang_backstop']);

/**
 * Whether a transition cause comes from the halting machinery itself and must
 * not feed the iteration-budget signals.
 *
 * @param cause - WorkflowTransition.cause value. / 遷移の原因
 * @returns True for halt/backstop causes. / 停止側の原因なら true
 */
export function isHaltSideTransitionCause(cause: string | null | undefined): boolean {
  return cause != null && HALT_SIDE_CAUSES.has(cause);
}

/** Time budget after which a task halts with 'budget_time_exceeded' (default 24h). */
export function iterationTimeBudgetMs(): number {
  const v = parseInt(process.env.RAPITAS_ITERATION_TIME_BUDGET_MS ?? '', 10);
  return Number.isFinite(v) && v > 0 ? v : 24 * 60 * 60 * 1000;
}

/** Cost budget after which a task halts with 'budget_cost_exceeded' — reuses task-budget.ts's env var. */
export function iterationCostBudgetUsd(): number {
  const v = parseFloat(process.env.RAPITAS_TASK_BUDGET_USD ?? '');
  return Number.isFinite(v) && v >= 0 ? v : 25;
}

/** AgentExecution count within the window after which a task halts with 'budget_attempts_exceeded' (default 8). */
export function iterationAttemptsBudget(): number {
  const v = parseInt(process.env.RAPITAS_ITERATION_ATTEMPTS_BUDGET ?? '', 10);
  return Number.isFinite(v) && v > 0 ? v : 8;
}

/** Minimum same/regressed workflowStatus repeats within the window to count as no-progress condition ① (default 2). */
export function noProgressStatusRepeatMin(): number {
  const v = parseInt(process.env.RAPITAS_ITERATION_NO_PROGRESS_STATUS_REPEAT_MIN ?? '', 10);
  return Number.isFinite(v) && v > 0 ? v : 2;
}

/** Minimum AgentExecution count within the window to count as no-progress condition ③ (default 3, lower than the attempts budget). */
export function noProgressAttemptsMin(): number {
  const v = parseInt(process.env.RAPITAS_ITERATION_NO_PROGRESS_ATTEMPTS_MIN ?? '', 10);
  return Number.isFinite(v) && v > 0 ? v : 3;
}

/**
 * Start of the current iteration window (most recent reset), following the
 * same event-driven-reset pattern as verify-self-repair-budget.ts's
 * resolveRepairWindowStart — old repeat/attempt counts must not be carried
 * past a manual retry, a question resolution, or a plan regeneration, all of
 * which grant the task a fresh slate.
 *
 * @param taskId - Task id / タスクID
 * @returns Window start, or null when never reset. / 窓の起点、無ければ null
 */
export async function resolveIterationWindowStart(taskId: number): Promise<Date | null> {
  const row = await prisma.workflowTransition
    .findFirst({
      where: { taskId, cause: { in: WINDOW_RESET_CAUSES } },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    })
    .catch(() => null);
  return row?.createdAt ?? null;
}

/** Pure snapshot input for {@link resolveIterationBudgetState}. */
export interface IterationBudgetInput {
  nowMs: number;
  /** Window start (resolveIterationWindowStart result, or the task's createdAt when never reset). */
  windowStartMs: number;
  spentUsd: number;
  /** AgentExecution rows for this task since windowStartMs (or never started). */
  attemptsInWindow: number;
  /**
   * Same-cause repeat-loop detection result (detectRepeatLoop's own
   * forgiveness-budget-aware output) — null when no loop is detected.
   */
  repeatLoop: { cause: string; count: number } | null;
  /** Count of times workflowStatus repeated the same or a regressed value within the window (condition ①). */
  statusRepeatCount: number;
  /**
   * Whether this task can structurally gain a live execution at all — mirrors
   * detectStagnation's StagnationInput.isWorkflowManaged. `false` skips
   * detection entirely (a legitimate indefinite wait, not a stall).
   */
  isWorkflowManaged?: boolean | null;
  /** True when the operator explicitly withdrew this task (#875) — mirrors StagnationInput.manuallyWithdrawn. */
  manuallyWithdrawn?: boolean | null;
  /** False when the task's theme has auto-run disabled — mirrors detectStagnation's themeAutoRunEnabled gate. */
  themeAutoRunEnabled?: boolean | null;
}

/** ResumeCondition attached to a repeat_cause_detected/no_progress halt. */
function newHypothesisResumeCondition(note: string): ResumeCondition {
  return { requiresNewHypothesis: true, note };
}

/**
 * Evaluate a task's combined iteration budget (pure, DB-independent).
 *
 * Priority when multiple axes exceed simultaneously: time > cost > attempts >
 * repeat_cause > no_progress — only the first match is returned (see
 * task-iteration-budget.types.ts HaltReason doc).
 *
 * NOTE on repeat_cause vs no_progress and condition ②: plan.md's "進展なし
 *判定" defines condition② as "no new incident signature in the window",
 * which by construction cannot hold at the same time repeatLoop is non-null
 * (a detected repeat loop IS a new signature). repeat_cause_detected
 * therefore evaluates only conditions ①+③ (same/regressed status repeating
 * AND enough attempts) together with the repeat-loop signal itself as the
 * anomaly; no_progress evaluates the full ①+②+③ (no repeat-loop signature at
 * all — pure stagnation, not even a repeating same-cause failure).
 *
 * @param input - Task snapshot (see IterationBudgetInput). / タスクの反復予算スナップショット
 * @returns Halt decision, or shouldHalt=false when within budget / 除外条件に該当. / 停止判定
 */
export function resolveIterationBudgetState(input: IterationBudgetInput): IterationBudgetState {
  if (input.isWorkflowManaged === false) return { shouldHalt: false };
  if (input.manuallyWithdrawn) return { shouldHalt: false };
  if (input.themeAutoRunEnabled === false) return { shouldHalt: false };

  const diagnostics = {
    statusRepeatCount: input.statusRepeatCount,
    attempts: input.attemptsInWindow,
    repeatLoop: input.repeatLoop,
  };
  const elapsedMs = input.nowMs - input.windowStartMs;
  if (elapsedMs >= iterationTimeBudgetMs()) {
    return { shouldHalt: true, haltReason: 'budget_time_exceeded' as HaltReason, diagnostics };
  }
  if (input.spentUsd >= iterationCostBudgetUsd()) {
    return { shouldHalt: true, haltReason: 'budget_cost_exceeded' as HaltReason, diagnostics };
  }
  if (input.attemptsInWindow >= iterationAttemptsBudget()) {
    return { shouldHalt: true, haltReason: 'budget_attempts_exceeded' as HaltReason, diagnostics };
  }

  const statusRepeatOk = input.statusRepeatCount >= noProgressStatusRepeatMin();
  const attemptsOk = input.attemptsInWindow >= noProgressAttemptsMin();

  if (input.repeatLoop !== null && statusRepeatOk && attemptsOk) {
    return {
      shouldHalt: true,
      haltReason: 'repeat_cause_detected' as HaltReason,
      diagnostics,
      resumeCondition: newHypothesisResumeCondition(
        `同一原因(${input.repeatLoop.cause})の反復が${input.repeatLoop.count}回検出され、進展がありません。`,
      ),
    };
  }

  if (input.repeatLoop === null && statusRepeatOk && attemptsOk) {
    return {
      shouldHalt: true,
      haltReason: 'no_progress' as HaltReason,
      diagnostics,
      resumeCondition: newHypothesisResumeCondition(
        '一定回数の試行を重ねても状態が進展していません。',
      ),
    };
  }

  return { shouldHalt: false };
}

/** Per-task consecutive DB-read-failure counter for {@link resolveIterationBudgetForTask}'s fail-open escalation. */
const consecutiveReadFailures = new Map<number, number>();

/**
 * DB-wiring assembler for {@link resolveIterationBudgetState}. Fails open on
 * any read error (never halts a task on a DB blip) and escalates via a
 * distinct log signature once 3 consecutive failures occur for the same task
 * — an unconditional fail-open would otherwise hide a sustained outage.
 *
 * @param taskId - Task about to be considered for dispatch. / 判定対象タスク
 * @param guards - Structural/withdrawal gates the caller already knows (mirrors detectStagnation's caller-supplied gates). / 呼び出し元が把握済みの除外ゲート
 * @param nowMs - Current time (ms), injectable for tests. / 現在時刻
 * @returns Halt decision, shouldHalt=false on any read failure. / 停止判定
 */
export async function resolveIterationBudgetForTask(
  taskId: number,
  guards: {
    isWorkflowManaged?: boolean | null;
    manuallyWithdrawn?: boolean | null;
    themeAutoRunEnabled?: boolean | null;
  },
  nowMs: number = Date.now(),
): Promise<IterationBudgetState> {
  try {
    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: { workflowStatus: true, createdAt: true },
    });
    if (!task) return { shouldHalt: false };

    const windowStart = (await resolveIterationWindowStart(taskId)) ?? task.createdAt;
    const windowStartMs = windowStart.getTime();

    const [spentUsd, attemptsInWindow, transitionsInWindow] = await Promise.all([
      getTaskSpendUsd(taskId),
      prisma.agentExecution.count({
        where: {
          session: { config: { taskId } },
          OR: [{ startedAt: null }, { startedAt: { gte: windowStart } }],
        },
      }),
      prisma.workflowTransition.findMany({
        where: { taskId, createdAt: { gte: new Date(nowMs - REPEAT_LOOP_WINDOW_MS) } },
        select: {
          cause: true,
          createdAt: true,
          actor: true,
          invariantViolation: true,
          toStatus: true,
          fromStatus: true,
        },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    // Drop the stop side's own transitions before either signal below —
    // otherwise each halt re-arms the next one (see HALT_SIDE_CAUSES).
    const workTransitions = transitionsInWindow.filter((t) => !isHaltSideTransitionCause(t.cause));

    const repeatLoop = detectRepeatLoop({
      transitions: workTransitions.map((t) => ({
        cause: t.cause,
        createdAtMs: t.createdAt.getTime(),
        actor: t.actor,
        invariantViolation: t.invariantViolation,
      })),
      nowMs,
      taskStatus: undefined,
    });

    // Condition ①: transitions that did not advance the workflow (same status
    // re-recorded or a step back), excluding reset-family causes. NOTE: the old
    // "toStatus === current workflowStatus" count fired on progressing tasks
    // whose re-runs passed the same statuses twice (task 994, 984/986).
    const statusRepeatCount = countNonAdvancingTransitions(
      workTransitions,
      isHaltSideTransitionCause,
    );

    consecutiveReadFailures.delete(taskId);
    return resolveIterationBudgetState({
      nowMs,
      windowStartMs,
      spentUsd,
      attemptsInWindow,
      repeatLoop,
      statusRepeatCount,
      ...guards,
    });
  } catch (err) {
    const failures = (consecutiveReadFailures.get(taskId) ?? 0) + 1;
    consecutiveReadFailures.set(taskId, failures);
    log.warn(
      { err, taskId, failures },
      '[task-iteration-budget] Read failed — failing open (no halt) this evaluation',
    );
    if (failures >= 3) {
      log.error(
        { taskId, failures },
        '[task-iteration-budget] 3+ consecutive read failures — iteration budget is blind for this task, investigate DB connectivity',
      );
      // fail-open unconditionally hides an outage (plan.md §DB参照失敗時の方針) —
      // surface it via the concern backlog so a sustained DB problem is not
      // silently swallowed. dedupKey collapses repeats of the SAME task's
      // ongoing outage into one open concern instead of filing on every
      // subsequent evaluation past the 3rd failure.
      submitConcern({
        title: `タスク#${taskId}の反復予算判定がDB参照失敗で3回連続blind化`,
        detail:
          `task-iteration-budget.ts の resolveIterationBudgetForTask がタスク#${taskId}に対して` +
          `${failures}回連続でDB参照に失敗し、fail-openのため停止判定を行えていません。` +
          `DB接続状況を確認してください。`,
        type: 'other',
        severity: 'medium',
        location: 'rapitas-backend/services/workflow/task-iteration-budget.ts',
        originTaskId: taskId,
        source: 'agent',
        dedupKey: `task-iteration-budget:read-failure-escalation:${taskId}`,
      }).catch((concernErr) => {
        log.warn(
          { err: concernErr, taskId },
          '[task-iteration-budget] Failed to file the read-failure escalation concern',
        );
      });
    }
    return { shouldHalt: false };
  }
}
