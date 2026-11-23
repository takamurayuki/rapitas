/**
 * plan-question-budget-gate
 *
 * One step of the question.md save path: decide what happens to a new
 * plan-phase question round once its budget axis is exhausted — adopt the
 * recommended option when that is safe, otherwise block the task and refuse
 * the save. Extracted from status-transition.ts, which is already past the
 * 300-line soft limit — this owns only that decision, not the status
 * transition it guards.
 */
import { createLogger } from '../../../../config/logger';
import { ConflictError } from '../../../../middleware/error-handler';
import {
  checkPlanQuestionBudget,
  blockPlanQuestionOverBudget,
} from '../../../../services/workflow/workflow-plan-question-guard';
import {
  isQuestionBlockEligibleForAutoAnswer,
  type ParsedQuestionBlock,
} from '../../../../services/workflow/question-options-parser';
import { recordTransition } from '../../../../services/workflow/transition-recorder';

const log = createLogger('workflow:plan-question-budget-gate');

/** Cause recorded when an exhausted agent budget adopts the recommendation. */
export const PLAN_QUESTION_AUTO_ADOPT_CAUSE = 'plan_question_budget_auto_adopt';

/** How long to let the question.md save commit before answering it. */
const AUTO_ADOPT_DELAY_MS = 3_000;

/**
 * Rounds past the cap that may still auto-adopt; beyond them the task blocks.
 *
 * NOTE: Unbounded adoption looped TempoRaid task 1403 (2026-11-23): its
 * planner kept producing a broken plan (a Codex output bug dropped lines), the
 * implementer asked the same question each round, "revise the plan" was
 * adopted, and the planner failed again — five adopted rounds in under an
 * hour, with auto-run paused, since answer-driven phases dispatch directly.
 */
const MAX_AUTO_ADOPTED_ROUNDS = 2;

/** What happened to the round. */
export type PlanQuestionBudgetOutcome = 'allowed' | 'auto_adopt';

/** Injectable side effects (tests). */
export interface PlanQuestionBudgetDeps {
  /** Answer the just-saved question with its recommended options, later. */
  scheduleAutoAdopt: (taskId: number) => void;
}

/**
 * Answer the saved question with its recommended options through the same
 * path as a human answer, once the save has committed.
 *
 * @param taskId - Task whose question.md was just saved / 対象タスク
 */
function scheduleAutoAdoptAfterSave(taskId: number): void {
  const timer = setTimeout(() => {
    void import('./plan-question-auto-adopt')
      .then((m) => m.adoptRecommendedAnswer(taskId))
      .catch((err) => log.warn({ err, taskId }, '[plan-question] auto-adopt failed'));
  }, AUTO_ADOPT_DELAY_MS);
  // Never the reason a process (or a test run) stays alive.
  timer.unref?.();
}

const defaultDeps: PlanQuestionBudgetDeps = { scheduleAutoAdopt: scheduleAutoAdoptAfterSave };

/**
 * Enforce the plan-phase question budget for one incoming round.
 *
 * `waitsOnOperator` decides WHICH budget the round is charged to. The two axes
 * are separate because an agent asking again and a task waiting for a human to
 * act have different owners: the agent can stop asking, but it cannot make the
 * human act, so sharing one budget makes the task fail whenever the human is
 * slower than the cap. Measured on #1215 — three rounds shared the budget and
 * the fourth, "hold until the operator finishes", was refused at 3/3 and the
 * task went blocked.
 *
 * NOTE: Once the AGENT axis is spent, a round whose every recommendation is
 * safe to adopt (no gate change, no operator work — the same test the
 * no-answer timeout uses) is answered with those recommendations instead of
 * blocking. Blocking sent TempoRaid task 1347 (2026-11-23) to the blocked
 * auto-retry, which reset it to draft and reused the same plan, so the
 * implementer stopped on the same question again — a loop only a human could
 * break. The operator axis never auto-adopts: no answer can do a human's work.
 *
 * @param taskId - Task raising the question. / 質問を上げたタスク
 * @param waitsOnOperator - Whether this round waits on human work. / 人の作業待ちか
 * @param block - The round's parsed `json:options`, if any. / 質問の選択肢ブロック
 * @param deps - Injectable scheduler (tests). / 依存の注入
 * @returns 'allowed' within budget, 'auto_adopt' when the recommendation will be applied. / 判定
 * @throws {ConflictError} When the charged axis is exhausted and nothing can be adopted. / 該当軸が尽き自動採用もできない場合
 */
export async function enforcePlanQuestionBudget(
  taskId: number,
  waitsOnOperator: boolean,
  block: ParsedQuestionBlock | null = null,
  deps: PlanQuestionBudgetDeps = defaultDeps,
): Promise<PlanQuestionBudgetOutcome> {
  const budget = await checkPlanQuestionBudget(taskId, waitsOnOperator);
  if (budget.allowed) return 'allowed';

  const axis = budget.exhausted ?? 'agent';
  const used = axis === 'operator' ? budget.operatorCount : budget.count;
  const cap = axis === 'operator' ? budget.operatorLimit : budget.limit;

  // `used` counts the prior rounds, so rounds cap+1 … cap+MAX are adopted.
  const withinAutoAdopt = used < cap + MAX_AUTO_ADOPTED_ROUNDS;
  if (
    axis === 'agent' &&
    withinAutoAdopt &&
    block &&
    isQuestionBlockEligibleForAutoAnswer(block).eligible
  ) {
    await recordTransition({
      taskId,
      fromStatus: 'plan_approved',
      toStatus: 'plan_approved',
      actor: 'system',
      cause: PLAN_QUESTION_AUTO_ADOPT_CAUSE,
      phase: 'plan',
      metadata: {
        count: used,
        limit: cap,
        recommended: block.questions.map((q) => ({ questionId: q.id, key: q.recommended })),
      },
    }).catch(() => {});
    log.info(
      { taskId, count: used, limit: cap },
      '[plan-question] agent question budget spent — adopting the recommended option instead of blocking',
    );
    deps.scheduleAutoAdopt(taskId);
    return 'auto_adopt';
  }

  await blockPlanQuestionOverBudget(taskId, used, cap, axis);
  throw new ConflictError(
    `plan-phase question rounds reached the ${axis} lifetime cap (${used}/${cap}); task blocked instead of raising another question`,
    axis === 'operator' ? 'OPERATOR_ACTION_WAIT_EXHAUSTED' : 'PLAN_QUESTION_BUDGET_EXHAUSTED',
  );
}
