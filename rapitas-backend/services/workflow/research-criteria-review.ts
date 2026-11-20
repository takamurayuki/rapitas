/**
 * research-criteria-review
 *
 * Acts on the completion-criteria review the researcher wrote into
 * research.md (#1561). The plan is made against the criteria, so they must be
 * settled before it: a "revise" on a person's task stops the workflow at
 * awaiting_question with the findings and the proposed rewrite, and the
 * answer resumes at research_done — the research stands, only the criteria
 * changed, so it is not run again. A task the system filed adopts the
 * proposal and goes on (approved 2026-11-16).
 *
 * Every review is recorded as `criteria_reviewed` with its finding kinds,
 * the evidence for moving a kind into the rule layer (criteria-autofix.ts).
 * Runs only on a task just settled at research_done, so a resumed task is
 * not asked again and the HTTP save and the CLI epilogue cannot both ask.
 * Fails open: a missing block or a refused write lets the task go on.
 */
import { prisma } from '../../config';
import { createLogger } from '../../config/logger';
import { writeWorkflowFile } from './workflow-file-utils';
import { recordTransition } from './transition-recorder';
import { notifyIntakeQuestionPending } from '../communication/notification-service';
import { writeTaskCriteria, type CriteriaWriteDb } from '../task/task-criteria-write';
import { parseSpecArray } from '../intake/spec-quality-checker';
import { extractResearchCriteriaReview, type CriteriaReview } from './criteria-review';
import { listOpenItems } from './mode-escalation';
import {
  CRITERIA_OPTION,
  CRITERIA_QUESTION_ID,
  reviewQuestion,
} from './research-criteria-question';

export { CRITERIA_QUESTION_ID, reviewQuestion } from './research-criteria-question';

const log = createLogger('research-criteria-review');

/** Transition causes this records. */
export const RESEARCH_CRITERIA_CAUSES = {
  reviewed: 'criteria_reviewed',
  adopted: 'criteria_review_adopted',
  question: 'criteria_review_question',
} as const;

type Row = {
  id: number;
  title: string;
  workflowStatus: string | null;
  acceptanceCriteria: unknown;
  autoCreatedFromBacklog?: boolean | null;
  agentGenerated?: boolean | null;
  theme: { isDevelopment: boolean } | null;
};

const db = prisma as unknown as CriteriaWriteDb;

/**
 * Settle the criteria from the researcher's review before the plan is made.
 *
 * @param taskId - Task whose research.md was just saved / research.md を保存したタスク
 * @param researchMd - The saved research.md / 保存した調査結果
 * @returns True when the task was stopped for the person / 人の確認待ちにした場合 true
 */
export async function settleCriteriaFromResearch(
  taskId: number,
  researchMd: string,
): Promise<boolean> {
  try {
    const row = (await prisma.task.findUnique({
      where: { id: taskId },
      include: { theme: { select: { isDevelopment: true } } },
    })) as unknown as Row | null;
    if (!row?.theme?.isDevelopment || row.workflowStatus !== 'research_done') return false;
    const criteria = parseSpecArray(row.acceptanceCriteria);
    if (criteria.length === 0) return false;
    const review = extractResearchCriteriaReview(researchMd, criteria.length);
    if (!review) {
      log.info({ taskId }, '[research-criteria] research.md carries no criteria review');
      return false;
    }
    await record(taskId, RESEARCH_CRITERIA_CAUSES.reviewed, {
      verdict: review.verdict,
      findings: review.findings.map((f) => ({ index: f.index, kind: f.kind })),
    });
    if (review.verdict === 'ok') return false;
    if (row.autoCreatedFromBacklog === true || row.agentGenerated === true) {
      await adopt(row, criteria, review);
      return false;
    }
    await ask(row, criteria, review, listOpenItems(researchMd));
    return true;
  } catch (err) {
    log.warn({ err, taskId }, '[research-criteria] could not settle the criteria — going on');
    return false;
  }
}

async function adopt(row: Row, before: string[], review: CriteriaReview) {
  const written = await writeTaskCriteria(db, {
    taskId: row.id,
    next: { acceptanceCriteria: review.proposed },
    actor: 'system:research-criteria-review',
  });
  if (!written.ok) {
    log.warn({ taskId: row.id, reason: written.reason }, '[research-criteria] proposal refused');
    return;
  }
  await record(row.id, RESEARCH_CRITERIA_CAUSES.adopted, {
    before,
    after: review.proposed,
    findings: review.findings,
  });
}

async function ask(row: Row, criteria: string[], review: CriteriaReview, openItems: string[]) {
  await writeWorkflowFile(
    row.id,
    'question',
    reviewQuestion(row.title, criteria, review, openItems),
  );
  await prisma.task.update({
    where: { id: row.id },
    data: { workflowStatus: 'awaiting_question', updatedAt: new Date() },
  });
  // NOTE: resume, not spec_change. A spec_change answer archives and resets
  // to draft, which would run the research again; here the research stands
  // and the answer returns to research_done, before the plan.
  await record(
    row.id,
    RESEARCH_CRITERIA_CAUSES.question,
    {
      previousStatus: 'research_done',
      kind: 'execution_continuation',
      findings: review.findings,
      // Kept for applyCriteriaReviewSelection: the button applies this rewrite.
      proposedCriteria: review.proposed,
    },
    'awaiting_question',
  );
  await notifyIntakeQuestionPending({ taskId: row.id, taskTitle: row.title }).catch(() => {});
}

/**
 * Apply the person's answer to a criteria question: write the rewrite when
 * they chose it.
 *
 * Collected input must reach the result (lesson 2026-11): picking 「推奨の完了
 * 条件に書き換える」 has to change the criteria the plan is made against, not
 * just be recorded as an answer.
 *
 * @param taskId - Task being answered / 回答対象のタスク
 * @param questionMeta - Metadata of the criteria_review_question transition / 質問の遷移メタデータ
 * @param selections - The person's choices / 選択結果
 * @returns True when the criteria were rewritten / 書き換えた場合 true
 */
export async function applyCriteriaReviewSelection(
  taskId: number,
  questionMeta: Record<string, unknown> | null | undefined,
  selections: { questionId: string; selectedKey: string | null }[] | undefined,
): Promise<boolean> {
  const picked = selections?.find((s) => s.questionId === CRITERIA_QUESTION_ID);
  if (picked?.selectedKey !== CRITERIA_OPTION.adopt) return false;
  const proposed = parseSpecArray(questionMeta?.proposedCriteria);
  if (proposed.length === 0) {
    log.warn({ taskId }, '[research-criteria] adopt chosen but the question kept no rewrite');
    return false;
  }
  const written = await writeTaskCriteria(db, {
    taskId,
    next: { acceptanceCriteria: proposed },
    actor: 'user:research-criteria-review',
  });
  if (!written.ok) {
    log.warn({ taskId, reason: written.reason }, '[research-criteria] chosen rewrite refused');
    return false;
  }
  await record(taskId, RESEARCH_CRITERIA_CAUSES.adopted, { after: proposed, chosenBy: 'person' });
  return true;
}

async function record(
  taskId: number,
  cause: string,
  metadata: Record<string, unknown>,
  toStatus = 'research_done',
) {
  await recordTransition({
    taskId,
    fromStatus: 'research_done',
    toStatus,
    actor: 'system',
    cause,
    phase: 'research',
    metadata,
  }).catch((err) => log.warn({ err, taskId, cause }, '[research-criteria] could not record'));
}
