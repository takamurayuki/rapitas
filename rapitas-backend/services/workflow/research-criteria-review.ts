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
    },
    'awaiting_question',
  );
  await notifyIntakeQuestionPending({ taskId: row.id, taskTitle: row.title }).catch(() => {});
}

/**
 * The open items that ask the person something.
 *
 * NOTE: 未確定事項 also holds the researcher's own to-dos (「全数確認する」,
 * 「詳細に確認する」). Listed as questions they asked the person to do the
 * research (task 1510), so only items phrased as a question are kept: one
 * with 「か」 closing a clause, or a question mark.
 */
function asks(items: string[]): string[] {
  return items.filter((item) => /か[。、？?]|か$|[？?]/.test(item.trim()));
}

/** Finding kinds that mean the criterion does not say what the person wants. */
const PURPOSE_KINDS = new Set(['insufficient', 'ambiguous']);

/**
 * Whether no criterion says what the person wants: every one carries an
 * insufficient or ambiguous finding. Then the rewrite is the researcher's
 * guess at the goal, not a sharper way to check a known one.
 */
function purposeUnclear(criteria: string[], review: CriteriaReview): boolean {
  if (criteria.length === 0) return false;
  return criteria.every((_, i) =>
    review.findings.some((f) => (f.index === i || f.index === null) && PURPOSE_KINDS.has(f.kind)),
  );
}

/**
 * The question a person answers when the researcher proposes a rewrite.
 *
 * NOTE: When no criterion says what the person wants (task 1509,
 * 「使いやすくなっていること」), it asks for the purpose first, from the items
 * research could not settle, and shows the rewrite as the researcher's guess.
 * It used to present that guess as the answer to accept, which would build
 * features nobody asked for.
 *
 * @param title - Task title / タスク名
 * @param criteria - The criteria as they stand / 現在の受入条件
 * @param review - The researcher's review / 点検結果
 * @param openItems - Items under research.md's 未確定事項 / 調査で残った未確定事項
 * @returns question.md body / 質問の本文
 */
export function reviewQuestion(
  title: string,
  criteria: string[],
  review: CriteriaReview,
  openItems: string[] = [],
): string {
  const KIND_JA: Record<string, string> = {
    unverifiable: '作業中に確かめられない',
    contradiction: '制約・範囲外と矛盾する',
    insufficient: '満たしてもゴールに届かない',
    ambiguous: '読み方が割れる',
    unrelated: 'このタスクと関係がない',
  };
  const findings = review.findings.map((f) => {
    const which = f.index !== null && criteria[f.index] ? `「${criteria[f.index]}」` : '条件全体';
    return `- ${which}: ${KIND_JA[f.kind] ?? f.kind} — ${f.problem}`;
  });
  if (purposeUnclear(criteria, review)) {
    return [
      '# 仕様確認: 何を良くしたいかの確認',
      '',
      `タスク「${title}」の完了条件からは、何を変えれば完了なのかが読み取れません。エージェントが目的を推測して作ると、頼んでいない変更になりかねないため、計画の前で止めています。`,
      '',
      '## 教えてほしいこと',
      ...(asks(openItems).length > 0
        ? asks(openItems).map((q) => `- ${q}`)
        : ['- 何に困っていて、どうなれば良いのか']),
      '',
      '## 指摘',
      ...findings,
      '',
      '## 書き直しの例（エージェントの推測）',
      '依頼にない内容を含むかもしれません。目的に合うものだけを使ってください。',
      ...review.proposed.map((p) => `- ${p}`),
      '',
      'タスクの詳細で目的（ゴール）と完了条件を書き換えてから回答してください。回答すると、調査はやり直さずに計画から進みます。',
    ].join('\n');
  }
  return [
    '# 仕様確認: 完了条件の見直しの提案',
    '',
    `タスク「${title}」を調査したところ、完了条件（エージェントが確かめる）に、差し戻しの原因になりそうな点がありました。計画は完了条件が決まってから作るため、ここで止めています。`,
    '',
    '## 指摘',
    ...findings,
    '',
    '## 書き直しの案',
    ...review.proposed.map((p) => `- ${p}`),
    '',
    '案でよければ、タスクの詳細で完了条件を書き換えてから回答してください。いまの条件のままでよければ、そのまま回答してください。回答すると、調査はやり直さずに計画から進みます。',
  ].join('\n');
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
