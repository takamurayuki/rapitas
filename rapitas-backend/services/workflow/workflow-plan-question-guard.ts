/**
 * Workflow Plan-Question Guard
 *
 * Bounds how many times the planner may raise question.md while the workflow
 * sits in the plan phase (`cause: 'file_saved:question'`,
 * `fromStatus: 'plan_approved'`). Modeled on
 * workflow-orchestrator-plan-guard.ts's MAX_PLAN_REPLANS cap: the count is
 * LIFETIME (never reset by a windowed cause), because
 * `intake_question_answered` / `question_resolved` returns the task to
 * `draft` and a windowed count would reset every round (the same defect
 * fixed for verify-repair by countLifetimeRepairs, task 907/946). Only rows
 * raised FROM `plan_approved` are counted — intake questions (raised before
 * research starts) keep their own separate ask/best-guess policy
 * (intake-policy.ts) and must not share this budget.
 */
import { prisma } from '../../config';
import { createLogger } from '../../config/logger';
import { writeBlockedStatusDurable } from './durable-blocked-write';
import { transitionWaitedOnOperator } from './question-operator-action';
import { recordTransition } from './transition-recorder';

const log = createLogger('workflow:plan-question-guard');

/** cause recorded on the WorkflowTransition row when a plan-phase question is raised. */
const PLAN_QUESTION_CAUSE = 'file_saved:question';

/** Default lifetime cap on plan-phase question rounds; overridable via env. */
const DEFAULT_MAX_PLAN_QUESTION_ROUNDS = 3;

/**
 * Default lifetime cap on rounds that wait on OPERATOR work. Deliberately the
 * same number as the agent axis: B6's finding was that the two shared one
 * budget, not that the budget was too small. Separating them is the fix; a
 * larger number here would only move the same failure later.
 */
const DEFAULT_MAX_OPERATOR_WAIT_ROUNDS = 3;

/** Resolve the configured lifetime cap on plan-phase question rounds. */
function resolveMaxPlanQuestionRounds(): number {
  const parsed = parseInt(process.env.RAPITAS_MAX_PLAN_QUESTION_ROUNDS ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_PLAN_QUESTION_ROUNDS;
}

/** Resolve the configured lifetime cap on operator-wait rounds. */
function resolveMaxOperatorWaitRounds(): number {
  const parsed = parseInt(process.env.RAPITAS_MAX_OPERATOR_WAIT_ROUNDS ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_OPERATOR_WAIT_ROUNDS;
}

/** Which axis ran out, when a round is refused. */
export type ExhaustedQuestionAxis = 'agent' | 'operator';

/** Result of {@link checkPlanQuestionBudget}. */
export interface PlanQuestionBudgetResult {
  /** Whether another plan-phase question.md save is still permitted. / 追加の質問保存を許可するか */
  allowed: boolean;
  /** Prior rounds the AGENT raised on its own (lifetime, operator waits excluded). / エージェント発の質問回数 */
  count: number;
  /** The configured cap `count` was compared against. / 比較対象の上限値 */
  limit: number;
  /** Prior rounds that were waiting on human work (lifetime). / 人の作業待ちだった回数 */
  operatorCount: number;
  /** The configured cap `operatorCount` was compared against. / 人の作業待ち軸の上限値 */
  operatorLimit: number;
  /** Which axis was exhausted; absent when allowed. / 尽きた軸（許可時は未設定） */
  exhausted?: ExhaustedQuestionAxis;
}

/** The prior rounds, or null when the history could not be read. */
async function readPriorRounds(taskId: number): Promise<{ metadata: unknown }[] | null> {
  // NOTE: status-transition.ts's generic transition-recorder call sets
  // `phase: fileType`, so a question.md save is ALWAYS recorded with
  // `phase: 'question'` regardless of which status it was raised from —
  // `phase` cannot distinguish a plan-origin question from an intake-origin
  // one. `fromStatus` is the field that actually carries the origin state
  // (set to `currentStatus` at raise time), so plan-origin rounds are
  // identified by `fromStatus: 'plan_approved'` instead.
  //
  // Rows, not a count: which axis a round belongs to lives in its metadata,
  // and Prisma has no JSON filter on SQLite. The row set is bounded by the two
  // caps plus whatever predates them, so this stays a handful of rows.
  return prisma.workflowTransition
    .findMany({
      where: { taskId, cause: PLAN_QUESTION_CAUSE, fromStatus: 'plan_approved' },
      select: { metadata: true },
    })
    .catch((err: unknown) => {
      log.warn(
        { err, taskId },
        '[plan-question] transition history unreadable — treating both budgets as exhausted (fail-closed)',
      );
      return null;
    });
}

/**
 * Count this task's prior plan-phase question rounds on two separate axes and
 * decide whether one more is allowed.
 *
 * The axes exist because the two things the old single count conflated have
 * different owners. An agent that keeps asking instead of implementing must be
 * stopped; a task waiting for a human to add a dependency or merge a PR cannot
 * be stopped by anything the agent does, and charging it to the same budget
 * means the task fails whenever the human is slower than three rounds — which
 * is exactly what happened to #1215.
 *
 * Fails CLOSED: an unreadable history exhausts both axes, so a DB hiccup stops
 * the loop rather than resetting it (see fail-closed-count.ts's rationale).
 *
 * @param taskId - Task id / タスクID
 * @param waitsOnOperator - Whether the NEW round waits on human work. / 新しい周が人の作業待ちか
 * @returns Budget verdict on both axes / 両軸の予算判定
 */
export async function checkPlanQuestionBudget(
  taskId: number,
  waitsOnOperator = false,
): Promise<PlanQuestionBudgetResult> {
  const limit = resolveMaxPlanQuestionRounds();
  const operatorLimit = resolveMaxOperatorWaitRounds();
  const rows = await readPriorRounds(taskId);
  if (rows === null) {
    return {
      allowed: false,
      count: limit,
      limit,
      operatorCount: operatorLimit,
      operatorLimit,
      exhausted: waitsOnOperator ? 'operator' : 'agent',
    };
  }

  const operatorCount = rows.filter((r) => transitionWaitedOnOperator(r.metadata)).length;
  const count = rows.length - operatorCount;
  const allowed = waitsOnOperator ? operatorCount < operatorLimit : count < limit;
  return {
    allowed,
    count,
    limit,
    operatorCount,
    operatorLimit,
    ...(allowed ? {} : { exhausted: waitsOnOperator ? ('operator' as const) : ('agent' as const) }),
  };
}

/** Per-axis wording for the block. The cause is what detectors and the UI key on. */
const AXIS_REPORT: Record<
  ExhaustedQuestionAxis,
  { cause: string; title: string; describe: (count: number, limit: number) => string }
> = {
  agent: {
    cause: 'plan_question_budget_exhausted',
    title: 'plan質問の上限到達（ブロック）',
    describe: (count, limit) =>
      `planフェーズの質問がライフタイム上限（${count}/${limit}）に達したため、追加の質問を保存せずブロックしました。手動で確認してください。`,
  },
  operator: {
    cause: 'operator_action_wait_exhausted',
    title: '運用者作業の待ちが上限到達（ブロック）',
    // The human reading this is the one holding the task up, so the message
    // names that instead of "asked too many times" — reporting it as the
    // agent's over-asking is how #1215's real blocker stayed invisible.
    describe: (count, limit) =>
      `運用者作業の完了を待つ質問が ${count}/${limit} 回に達しました。エージェント側では解消できません。plan.md の運用者作業の項目を実施してから再開してください。`,
  },
};

/**
 * Block a task whose plan-phase question rounds exhausted the lifetime
 * budget: mark it `blocked`, record an invariant-violation transition, and
 * notify a human. Does not touch or remove the question.md already saved —
 * the caller is responsible for refusing the NEW save that triggered this.
 *
 * @param taskId - Task id / タスクID
 * @param count - The exhausted lifetime count, for the log/notification. / 到達したライフタイム回数
 * @param limit - The configured cap, for the log/notification. / 設定上の上限
 * @param axis - Which axis ran out; decides the recorded cause and wording. / 尽きた軸
 */
export async function blockPlanQuestionOverBudget(
  taskId: number,
  count: number,
  limit: number,
  axis: ExhaustedQuestionAxis = 'agent',
): Promise<void> {
  const report = AXIS_REPORT[axis];
  log.warn(
    { taskId, count, limit, axis },
    '[Workflow] plan-phase question budget exhausted — blocking instead of raising another round',
  );
  await writeBlockedStatusDurable({
    taskId,
    log,
    source: 'PlanQuestionGuard',
    notification: {
      title: 'plan質問の上限到達によるブロックに失敗',
      message: `タスク #${taskId} を blocked にする更新が2回失敗しました。plan→question往復ループが再発する可能性があるため手動確認が必要です。`,
    },
  });
  await recordTransition({
    taskId,
    fromStatus: 'plan_approved',
    toStatus: 'plan_approved',
    actor: 'system',
    cause: report.cause,
    phase: 'plan',
    metadata: { count, limit, axis },
    invariantViolation: true,
    invariantMessage: `plan-phase question rounds reached the ${axis} lifetime cap (${count}/${limit}); blocked to stop the loop`,
  }).catch(() => {});
  import('../communication/notification-service')
    .then(({ createNotification }) =>
      createNotification({
        type: 'system',
        title: report.title,
        message: `タスク #${taskId} は${report.describe(count, limit)}`,
        link: `/tasks?taskId=${taskId}`,
        metadata: { taskId, count, limit, reason: report.cause },
      }),
    )
    .catch(() => {});
}
