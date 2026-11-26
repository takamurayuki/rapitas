/**
 * question-answer-routing
 *
 * Decides whether an answer to an implementer's question sends the task back
 * to plan revision or resumes the implementer with the plan untouched
 * (task 1546). 完了条件、ファイル範囲、方針への影響を判定する。
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
  | 'file_approval_required'
  | 'out_of_plan_files_approved'
  | 'legacy_plan_revision'
  | 'approach_change';

/** Result of {@link decideAnswerRouting}. */
export type AnswerRoutingDecision =
  | { route: 'resume' | 'grant' | 'reject'; reason: AnswerRoutingReason }
  | {
      route: 'revision';
      reason: AnswerRoutingReason;
      trigger: SelectedOption;
      requiresFileApproval?: true;
    };

export function requestsFileApproval(option: ParsedQuestionOption): boolean {
  return option.requiresPlanScopeRevision === true || !!option.grantsFiles?.length;
}

/** 選択肢の照合。許可を含む質問では選択キーの省略や重複を許さない。 */
export function matchQuestionSelections(
  content: string | null,
  selections: { questionId: string; selectedKey: string | null }[] = [],
) {
  const questions = content ? (parseQuestionOptionsBlock(content)?.questions ?? []) : [];
  const grantQuestions = questions.filter((q) => q.options.some(requestsFileApproval));
  const selected: SelectedOption[] = [];
  const seen = new Set<string>();
  let invalid = false;
  for (const { questionId, selectedKey } of selections) {
    if (seen.has(questionId)) invalid = true;
    seen.add(questionId);
    const questionMatches = questions.filter((q) => q.id === questionId);
    const question = questionMatches[0];
    const matches = question?.options.filter((o) => o.key === selectedKey);
    if (question && matches?.length) selected.push({ question, option: matches[0] });
    if (
      questionMatches.length !== 1 ||
      (selectedKey === null ? !question?.freeTextRequired : matches?.length !== 1)
    )
      invalid = true;
  }
  return {
    selected,
    invalid: invalid || grantQuestions.some((q) => !selected.some((s) => s.question === q)),
    hasGrantQuestion: grantQuestions.length > 0,
  };
}

/**
 * 完了条件と方針の変更は改訂する。ファイルの追加は運用者の承認を検証する。
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
    ({ option }) =>
      !option.planImpact && option.planRevision === true && !requestsFileApproval(option),
  );
  const legacyGate = legacy.find(({ option }) => option.mutatesGate);
  if (legacyGate) return { route: 'revision', reason: 'legacy_plan_revision', trigger: legacyGate };

  const scope = selected.filter(({ option }) => requestsFileApproval(option));
  if (scope.length > 0) {
    if (
      !opts.human ||
      scope.some(({ option }) => !option.grantsFiles?.length) ||
      selected.some(({ option }) => option.mutatesGate)
    ) {
      return { route: 'reject', reason: 'file_approval_required' };
    }
    if (legacy.length && !operatorResume)
      return {
        route: 'revision',
        reason: 'legacy_plan_revision',
        trigger: legacy[0],
        requiresFileApproval: true,
      };
    return { route: 'grant', reason: 'out_of_plan_files_approved' };
  }
  if (legacy.length) {
    return operatorResume
      ? { route: 'resume', reason: 'operator_resume_implementer' }
      : { route: 'revision', reason: 'legacy_plan_revision', trigger: legacy[0] };
  }
  return { route: 'resume', reason: 'no_plan_change' };
}
