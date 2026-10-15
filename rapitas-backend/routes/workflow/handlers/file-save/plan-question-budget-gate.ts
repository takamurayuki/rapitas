/**
 * plan-question-budget-gate
 *
 * One step of the question.md save path: refuse a new plan-phase question round
 * when its budget axis is exhausted, after blocking the task. Extracted from
 * status-transition.ts, which is already past the 300-line soft limit — this
 * owns only the refusal, not the status transition it guards.
 */
import { ConflictError } from '../../../../middleware/error-handler';
import {
  checkPlanQuestionBudget,
  blockPlanQuestionOverBudget,
} from '../../../../services/workflow/workflow-plan-question-guard';

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
 * @param taskId - Task raising the question. / 質問を上げたタスク
 * @param waitsOnOperator - Whether this round waits on human work. / 人の作業待ちか
 * @throws {ConflictError} When the charged axis is exhausted. / 該当軸が尽きた場合
 */
export async function enforcePlanQuestionBudget(
  taskId: number,
  waitsOnOperator: boolean,
): Promise<void> {
  const budget = await checkPlanQuestionBudget(taskId, waitsOnOperator);
  if (budget.allowed) return;

  const axis = budget.exhausted ?? 'agent';
  const used = axis === 'operator' ? budget.operatorCount : budget.count;
  const cap = axis === 'operator' ? budget.operatorLimit : budget.limit;
  await blockPlanQuestionOverBudget(taskId, used, cap, axis);
  throw new ConflictError(
    `plan-phase question rounds reached the ${axis} lifetime cap (${used}/${cap}); task blocked instead of raising another question`,
    axis === 'operator' ? 'OPERATOR_ACTION_WAIT_EXHAUSTED' : 'PLAN_QUESTION_BUDGET_EXHAUSTED',
  );
}
