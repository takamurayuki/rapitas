/**
 * decision-ledger/settle-filing
 *
 * Settles the decision to file a task, at the point that task ends. The
 * consistency checker cannot do it: a filing's outcome is not an execution's
 * exit status but whether the work landed.
 */

import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { kindFromNodeKey } from '../observability/decision-trace/node-key';

const log = createLogger('decision-ledger:settle-filing');

/** Task statuses meaning the filing produced nothing that will ever land. */
const FAILED_STATUSES = new Set(['blocked', 'cancelled']);

/** PR states counting as landed. */
const LANDED_PR_STATES = new Set(['merged', 'MERGED']);

/**
 * Judge one filing from the task it produced.
 *
 * `correct` requires work that actually landed, not merely a task that closed —
 * 154 of 176 filings reached done in the last 60 days, which says nothing about
 * whether any of them were worth making.
 *
 * Recurrence is deliberately NOT judged here: whether the concern comes back is
 * a future event, and a settlement that guessed at it would be inventing a
 * verdict. Those filings settle as `correct` on landing and would need a later
 * pass to be downgraded.
 */
function judgeFiling(taskStatus: string, landed: boolean): string | null {
  if (FAILED_STATUSES.has(taskStatus)) return 'inconsistent';
  if (taskStatus !== 'done') return null;
  return landed ? 'consistent' : 'skipped';
}

/**
 * Settle every pending filing decision belonging to a task.
 *
 * @param taskId - Task that just reached a terminal state. / 終端に達したタスクID
 * @returns Counts examined and settled. / 検査件数と確定件数
 */
export async function settleFilingDecisions(
  taskId: number,
): Promise<{ checked: number; settled: number }> {
  try {
    const pending = await prisma.agentDecisionTrace.findMany({
      where: { taskId, consistency: 'pending' },
      select: { id: true, nodeKey: true },
    });
    const filings = pending.filter((row) => kindFromNodeKey(row.nodeKey) === 'task_filing');
    if (filings.length === 0) return { checked: 0, settled: 0 };

    const task = await prisma.task.findUnique({ where: { id: taskId }, select: { status: true } });
    if (!task) return { checked: filings.length, settled: 0 };

    const pr = await prisma.gitHubPullRequest
      .findFirst({ where: { linkedTaskId: taskId }, select: { state: true } })
      .catch(() => null);
    const landed = pr ? LANDED_PR_STATES.has(pr.state) : false;

    const consistency = judgeFiling(task.status, landed);
    if (consistency === null) return { checked: filings.length, settled: 0 };

    const note =
      consistency === 'consistent'
        ? '起票した作業が実際にマージされた'
        : consistency === 'inconsistent'
          ? `起票した作業が ${task.status} で終わり、何も残らなかった`
          : '完了したがマージされた変更が無く、価値を判定できない';

    await prisma.agentDecisionTrace.updateMany({
      where: { id: { in: filings.map((f) => f.id) } },
      data: { consistency, consistencyNote: note, verifiedAt: new Date() },
    });
    log.info({ taskId, consistency, count: filings.length }, '[decision-ledger] settled filings');
    return { checked: filings.length, settled: filings.length };
  } catch (err) {
    log.warn({ err, taskId }, '[decision-ledger] filing settlement failed (non-fatal)');
    return { checked: 0, settled: 0 };
  }
}
