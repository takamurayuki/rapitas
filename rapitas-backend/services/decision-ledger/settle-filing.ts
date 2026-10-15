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

/** Upper bound on one sweep pass, mirroring the consistency checker's batching. */
const SWEEP_BATCH = 200;

/** A task abandoned outright — nothing was produced and nothing will be. */
const ABANDONED_STATUSES = new Set(['cancelled']);

/** PR states counting as landed. */
const LANDED_PR_STATES = new Set(['merged', 'MERGED']);

/**
 * How long a blocked task must sit untouched before its filing counts as
 * abandoned. Blocked is NOT terminal — task 672 was blocked, retried and ran
 * again — so a verdict written the moment it blocks is a guess about a story
 * that has not ended.
 */
const BLOCKED_ABANDONED_MS = 3 * 24 * 60 * 60 * 1000;

/** What is known about a filing's task at settlement time. */
export interface FilingOutcome {
  taskStatus: string;
  /** True when a PR linked to the task has merged. */
  landed: boolean;
  /** True when a PR exists but has not merged. */
  prPending: boolean;
  /** Milliseconds since the task last changed. */
  idleMs: number;
}

/**
 * Judge one filing, or decline to.
 *
 * A filing's worth is known only once its work LANDS, which happens after the
 * task itself finishes. Settling at task outcome wrote verdicts too early:
 * measured 2026-08-27, four filings whose PRs had merged were on record as
 * having produced nothing, because they were judged while blocked or while the
 * PR was still open, and a written verdict is never revisited.
 *
 * So this returns null — stay pending — for every state whose story is still
 * running, and the sweep asks again later.
 *
 * @param o - What is known about the task now. / 現時点で分かっていること
 * @returns The verdict, or null to stay pending. / 判定、まだ判定しないなら null
 */
export function judgeFiling(o: FilingOutcome): { consistency: string; note: string } | null {
  if (o.landed) {
    return { consistency: 'consistent', note: '起票した作業が実際にマージされた' };
  }
  if (ABANDONED_STATUSES.has(o.taskStatus)) {
    return { consistency: 'inconsistent', note: '起票した作業が中止され、何も残らなかった' };
  }
  // Blocked is retryable, so only prolonged silence settles it.
  if (o.taskStatus === 'blocked') {
    return o.idleMs >= BLOCKED_ABANDONED_MS
      ? {
          consistency: 'inconsistent',
          note: `起票した作業が ${Math.round(BLOCKED_ABANDONED_MS / 86400000)} 日以上 blocked のまま放置された`,
        }
      : null;
  }
  if (o.taskStatus !== 'done') return null;
  // Done with a PR still open: the outcome is coming, not absent.
  if (o.prPending) return null;
  return { consistency: 'skipped', note: '完了したがコード変更が無く、価値を判定できない' };
}

/**
 * Settle pending filing decisions — for one task, or across the whole ledger.
 *
 * The sweep form matters: a filing's PR merges well after its task finishes, so
 * a decision left pending at task outcome has to be asked about again. Without
 * it the ledger keeps whichever answer it had when the task happened to end.
 *
 * @param taskId - One task, or omit to sweep every pending filing. / 対象タスク、省略で全件
 * @returns Counts examined and settled. / 検査件数と確定件数
 */
export async function settleFilingDecisions(
  taskId?: number,
): Promise<{ checked: number; settled: number }> {
  try {
    const pending = await prisma.agentDecisionTrace.findMany({
      where: { consistency: 'pending', ...(taskId !== undefined ? { taskId } : {}) },
      select: { id: true, nodeKey: true, taskId: true },
      take: SWEEP_BATCH,
    });
    const filings = pending.filter((row) => kindFromNodeKey(row.nodeKey) === 'task_filing');
    if (filings.length === 0) return { checked: 0, settled: 0 };

    const now = Date.now();
    let settled = 0;
    // Group by task: several filings can share one task's fate.
    const byTask = new Map<number, number[]>();
    for (const f of filings) {
      if (f.taskId === null) continue;
      byTask.set(f.taskId, [...(byTask.get(f.taskId) ?? []), f.id]);
    }

    for (const [id, traceIds] of byTask) {
      const task = await prisma.task
        .findUnique({ where: { id }, select: { status: true, updatedAt: true } })
        .catch(() => null);
      if (!task) continue;

      const pr = await prisma.gitHubPullRequest
        .findFirst({ where: { linkedTaskId: id }, select: { state: true } })
        .catch(() => null);

      const verdict = judgeFiling({
        taskStatus: task.status,
        landed: pr ? LANDED_PR_STATES.has(pr.state) : false,
        prPending: pr ? !LANDED_PR_STATES.has(pr.state) : false,
        idleMs: now - task.updatedAt.getTime(),
      });
      if (!verdict) continue;

      await prisma.agentDecisionTrace.updateMany({
        where: { id: { in: traceIds } },
        data: {
          consistency: verdict.consistency,
          consistencyNote: verdict.note,
          verifiedAt: new Date(),
        },
      });
      settled += traceIds.length;
    }

    if (settled > 0) {
      log.info({ taskId: taskId ?? 'sweep', settled }, '[decision-ledger] settled filings');
    }
    return { checked: filings.length, settled };
  } catch (err) {
    log.warn({ err, taskId }, '[decision-ledger] filing settlement failed (non-fatal)');
    return { checked: 0, settled: 0 };
  }
}
