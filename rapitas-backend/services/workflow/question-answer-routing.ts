/**
 * question-answer-routing
 *
 * Decides whether an answer to an implementer's question sends the task back
 * to plan revision or resumes the implementer with the plan untouched
 * (task 1546). 完了条件と方針への影響を判定する。
 */
import {
  parseQuestionOptionsBlock,
  type ParsedQuestion,
  type ParsedQuestionOption,
} from './question-options-parser';

/** One option a caller selected, with the question it belongs to. */
export interface SelectedOption {
  question: ParsedQuestion;
  option: ParsedQuestionOption;
}

/** Why an answer was routed the way it was; recorded on the transition. / 振り分け理由 */
export type AnswerRoutingReason =
  | 'no_plan_change'
  | 'operator_resume_implementer'
  | 'criteria_change'
  | 'criteria_not_overridable'
  | 'legacy_plan_revision'
  | 'approach_change';

/** Result of {@link decideAnswerRouting}. */
export type AnswerRoutingDecision =
  | { route: 'resume'; reason: AnswerRoutingReason }
  | { route: 'revision'; reason: AnswerRoutingReason; trigger: SelectedOption };

/** 現在の質問本文にある選択肢を、回答の選択順に照合する。 */
export function matchQuestionSelections(
  content: string | null,
  selections: { questionId: string; selectedKey: string | null }[] = [],
): SelectedOption[] {
  const questions = content ? (parseQuestionOptionsBlock(content)?.questions ?? []) : [];
  const selected: SelectedOption[] = [];
  for (const { questionId, selectedKey } of selections) {
    const question = questions.find((q) => q.id === questionId);
    const option = question?.options.find((o) => o.key === selectedKey);
    if (question && option) selected.push({ question, option });
  }
  return selected;
}

/**
 * 完了条件と方針の変更は改訂する。実装の細部に関する回答は再開に回す。
 *
 * @param selected - Options the answer picked. / 選ばれた選択肢
 * @param opts - `human`: the answer is a human's; `resumeImplementer`: the operator asked to continue unchanged. / 人の回答か・継続指定
 * @returns The routing decision. / 振り分け結果
 */
export function decideAnswerRouting(
  selected: SelectedOption[],
  opts: { human: boolean; resumeImplementer?: boolean },
): AnswerRoutingDecision {
  const operatorResume = opts.human && opts.resumeImplementer === true;
  const criteria = selected.find(({ option }) => option.planImpact === 'criteria');
  if (criteria) {
    return {
      route: 'revision',
      reason: operatorResume ? 'criteria_not_overridable' : 'criteria_change',
      trigger: criteria,
    };
  }
  const approach = selected.find(({ option }) => option.planImpact === 'approach');
  if (approach) return { route: 'revision', reason: 'approach_change', trigger: approach };

  const legacy = selected.filter(
    ({ option }) => !option.planImpact && option.planRevision === true,
  );
  const legacyGate = legacy.find(({ option }) => option.mutatesGate);
  if (legacyGate) return { route: 'revision', reason: 'legacy_plan_revision', trigger: legacyGate };

  if (legacy.length) {
    return operatorResume
      ? { route: 'resume', reason: 'operator_resume_implementer' }
      : { route: 'revision', reason: 'legacy_plan_revision', trigger: legacy[0] };
  }
  return { route: 'resume', reason: 'no_plan_change' };
}
