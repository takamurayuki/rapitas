/**
 * plan-question-auto-adopt
 *
 * Answers a just-saved plan-phase question with its recommended options after
 * the agent's question budget ran out (see plan-question-budget-gate). Uses the
 * same answer path as a human answer, so a planRevision option still routes to
 * a replan. Not responsible for deciding WHETHER to adopt — the gate does that.
 */
import { prisma } from '../../../../config';
import { createLogger } from '../../../../config/logger';
import {
  composeAutoAnswerText,
  isQuestionBlockEligibleForAutoAnswer,
  parseQuestionOptionsBlock,
} from '../../../../services/workflow/question-options-parser';
import { writeWorkflowFile } from '../../../../services/workflow/workflow-file-utils';

const log = createLogger('workflow:plan-question-auto-adopt');

/** Label folded into the recorded answer. */
const SOURCE_LABEL = '推奨案の自動採用（質問の上限到達）';

/**
 * Adopt the recommended option of every question in the task's question.md.
 *
 * @param taskId - Task whose question.md was just saved / 対象タスク
 * @returns Whether an answer was applied / 回答を適用したか
 */
export async function adoptRecommendedAnswer(taskId: number): Promise<boolean> {
  const file = await prisma.workflowFile
    .findFirst({ where: { taskId, fileType: 'question' }, select: { content: true } })
    .catch(() => null);
  const block = file ? parseQuestionOptionsBlock(file.content) : null;
  if (!file || !block || !isQuestionBlockEligibleForAutoAnswer(block).eligible) {
    log.warn(
      { taskId },
      '[plan-question] question.md no longer adoptable — leaving it for a human',
    );
    return false;
  }

  const labels = block.questions
    .map((q) => q.options.find((o) => o.key === q.recommended)?.label ?? q.recommended)
    .join(' / ');
  const note =
    `\n\n## 自動採用（質問の上限到達）\n` +
    `plan フェーズの質問が上限に達したため、推奨選択肢「${labels}」を自動採用しました。` +
    `検証では、この採用を verify.md に記録してください。`;
  await writeWorkflowFile(taskId, 'question', `${file.content}${note}`).catch((err) =>
    log.warn({ err, taskId }, '[plan-question] failed to append the auto-adopt note'),
  );

  const { answerText, selections } = composeAutoAnswerText(block);
  // Dynamic import: the dispatcher sits above this file-save step in the
  // routes layer and imports the save path itself.
  const { applyQuestionAnswerByKind } = await import('../workflow-handlers-resume-dispatch');
  const applied = await applyQuestionAnswerByKind({
    taskId,
    answer: `${answerText}\n\n（${SOURCE_LABEL}。verify.md にこの採用を記録すること）`,
    actor: 'system',
    sourceLabel: SOURCE_LABEL,
    selections,
    extraMetadata: { reason: 'plan_question_budget_auto_adopt' },
  });
  // A plan revision only persists research_done; without a re-dispatch the
  // task stalls (task 1310, same handling as the no-answer timeout).
  if (applied.kind === 'plan_revision') {
    await import('../workflow-handlers-resume-redispatch')
      .then((m) => m.triggerReExecutionAfterAnswer(taskId))
      .catch((err) =>
        log.warn({ err, taskId }, '[plan-question] plan-revision re-dispatch failed'),
      );
  }
  log.info({ taskId, kind: applied.kind, labels }, '[plan-question] recommended option adopted');
  return true;
}
