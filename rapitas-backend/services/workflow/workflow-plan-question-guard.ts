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
import { countWithFailClosed } from '../../utils/database/fail-closed-count';
import { writeBlockedStatusDurable } from './durable-blocked-write';
import { recordTransition } from './transition-recorder';

const log = createLogger('workflow:plan-question-guard');

/** cause recorded on the WorkflowTransition row when a plan-phase question is raised. */
const PLAN_QUESTION_CAUSE = 'file_saved:question';

/** Default lifetime cap on plan-phase question rounds; overridable via env. */
const DEFAULT_MAX_PLAN_QUESTION_ROUNDS = 3;

/** Resolve the configured lifetime cap on plan-phase question rounds. */
function resolveMaxPlanQuestionRounds(): number {
  const parsed = parseInt(process.env.RAPITAS_MAX_PLAN_QUESTION_ROUNDS ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_PLAN_QUESTION_ROUNDS;
}

/** Result of {@link checkPlanQuestionBudget}. */
export interface PlanQuestionBudgetResult {
  /** Whether another plan-phase question.md save is still permitted. / 追加の質問保存を許可するか */
  allowed: boolean;
  /** Prior plan-phase question count (lifetime). / これまでのplanフェーズ質問回数 */
  count: number;
  /** The configured cap this count was compared against. / 比較対象の上限値 */
  limit: number;
}

/**
 * Count how many plan-phase question.md saves this task has ever had, and
 * decide whether one more is still allowed.
 *
 * @param taskId - Task id / タスクID
 * @returns Budget verdict / 予算判定
 */
export async function checkPlanQuestionBudget(taskId: number): Promise<PlanQuestionBudgetResult> {
  const limit = resolveMaxPlanQuestionRounds();
  const count = await countWithFailClosed(
    // NOTE: status-transition.ts's generic transition-recorder call sets
    // `phase: fileType`, so a question.md save is ALWAYS recorded with
    // `phase: 'question'` regardless of which status it was raised from —
    // `phase` cannot distinguish a plan-origin question from an intake-origin
    // one. `fromStatus` is the field that actually carries the origin state
    // (set to `currentStatus` at raise time), so plan-origin rounds are
    // identified by `fromStatus: 'plan_approved'` instead.
    prisma.workflowTransition.count({
      where: { taskId, cause: PLAN_QUESTION_CAUSE, fromStatus: 'plan_approved' },
    }),
    limit,
    log,
    { taskId },
    'plan-question',
  );
  return { allowed: count < limit, count, limit };
}

/**
 * Block a task whose plan-phase question rounds exhausted the lifetime
 * budget: mark it `blocked`, record an invariant-violation transition, and
 * notify a human. Does not touch or remove the question.md already saved —
 * the caller is responsible for refusing the NEW save that triggered this.
 *
 * @param taskId - Task id / タスクID
 * @param count - The exhausted lifetime count, for the log/notification. / 到達したライフタイム回数
 * @param limit - The configured cap, for the log/notification. / 設定上の上限
 */
export async function blockPlanQuestionOverBudget(
  taskId: number,
  count: number,
  limit: number,
): Promise<void> {
  log.warn(
    { taskId, count, limit },
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
    cause: 'plan_question_budget_exhausted',
    phase: 'plan',
    metadata: { count, limit },
    invariantViolation: true,
    invariantMessage: `plan-phase question rounds reached the lifetime cap (${count}/${limit}); blocked to stop the loop`,
  }).catch(() => {});
  import('../communication/notification-service')
    .then(({ createNotification }) =>
      createNotification({
        type: 'system',
        title: 'plan質問の上限到達（ブロック）',
        message: `タスク #${taskId} はplanフェーズの質問がライフタイム上限（${count}/${limit}）に達したため、追加の質問を保存せずブロックしました。手動で確認してください。`,
        link: `/tasks?taskId=${taskId}`,
        metadata: { taskId, count, limit, reason: 'plan_question_budget_exhausted' },
      }),
    )
    .catch(() => {});
}
