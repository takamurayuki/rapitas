/**
 * Intake: criteria rule fixes before start
 *
 * The rule layer of the criteria check (#1561), run before an agent starts a
 * development task: writing mistakes that failed runs have proven costly are
 * rewritten into a fixed form (criteria-autofix.ts) and recorded as
 * `criteria_auto_fixed`. No model call and no person — the review that needs
 * judgement is the researcher's, made with the code in front of it, and the
 * workflow waits on it before the plan (workflow/research-criteria-review.ts).
 *
 * Never stops a start: a refused write keeps the criteria as written.
 */
import { prisma } from '../../config';
import { createLogger } from '../../config/logger';
import { recordTransition } from '../workflow/transition-recorder';
import { writeTaskCriteria, type CriteriaWriteDb } from '../task/task-criteria-write';
import { parseSpecArray } from './spec-quality-checker';
import { autoFixCriteria, withHandoff } from './criteria-autofix';

const log = createLogger('intake-criteria-check');

/** Transition cause of a rule fix — the record the rule layer is judged by. */
export const CRITERIA_AUTO_FIXED_CAUSE = 'criteria_auto_fixed';

type Row = {
  id: number;
  title: string;
  description: string | null;
  workflowStatus: string | null;
  acceptanceCriteria: unknown;
  theme: { isDevelopment: boolean } | null;
};

const db = prisma as unknown as CriteriaWriteDb;

/**
 * Rewrite the evidence-backed mistakes in a development task's criteria.
 *
 * @param taskId - Task about to enter research / 調査に入るタスク
 * @returns The rules applied, empty when nothing changed / 適用した規則
 */
export async function applyCriteriaRuleFixes(taskId: number): Promise<string[]> {
  const row = (await prisma.task.findUnique({
    where: { id: taskId },
    include: { theme: { select: { isDevelopment: true } } },
  })) as unknown as Row | null;
  if (!row?.theme?.isDevelopment) return [];
  const criteria = parseSpecArray(row.acceptanceCriteria);
  if (criteria.length === 0) return [];

  const fix = autoFixCriteria({
    title: row.title,
    description: row.description,
    acceptanceCriteria: criteria,
  });
  if (fix.changes.length === 0) return [];
  const written = await writeTaskCriteria(db, {
    taskId,
    next: { acceptanceCriteria: fix.acceptanceCriteria },
    actor: 'system:criteria-autofix',
  });
  if (!written.ok) {
    log.warn(
      { taskId, reason: written.reason },
      '[criteria-check] rule fix refused — kept as written',
    );
    return [];
  }
  if (fix.handoffs.length > 0) {
    await prisma.task.update({
      where: { id: taskId },
      data: { description: withHandoff(row.description, fix.handoffs) },
    });
  }
  const fromStatus = row.workflowStatus ?? 'draft';
  await recordTransition({
    taskId,
    fromStatus,
    toStatus: fromStatus,
    actor: 'system',
    cause: CRITERIA_AUTO_FIXED_CAUSE,
    phase: 'question',
    metadata: { changes: fix.changes },
  }).catch((err) => log.warn({ err, taskId }, '[criteria-check] could not record the fix'));
  return fix.changes.map((c) => c.rule);
}
