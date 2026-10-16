/**
 * merge-exhausted-handoff
 *
 * One decision: a task parked at `verify_done` whose auto-merge candidate the
 * watcher has GIVEN UP on belongs to the operator, not to the scheduler — so
 * take it out of auto-run selection and let the theme move on.
 *
 * Why this exists. `required-merge-hold` parks a verified task at
 * `verify_done` on the premise that "the AutoMergeWatcher owns its
 * completion", and `auto-run-active-decision`'s `workflowSettled` defers the
 * hang backstop for exactly that reason. Both premises end the moment
 * `auto-merge-exhaustion` parks the candidate: the watcher then resumes ONLY
 * when the PR's head commit changes, which no agent will do, because the
 * completion gate keeps the task at `verify_done` and the scheduler never
 * dispatches another phase for it. Nothing owns the task, and nothing says so.
 *
 * Measured on task 1258 (2026-10-14): auto-merge exhausted at 13:06 on PR #912
 * with two red checks after `ci_repair` produced no diff. Over the following
 * 10.5 hours the scheduler enqueued 16 WorkflowQueueItems for it — one every
 * 41 minutes, each cancelled by the stale-item sweep after it ran with zero
 * agent executions — while holding theme 1's only concurrency slot against a
 * backlog of nine runnable tasks. Releasing the slot by hand was answered with
 * a fresh queue item 11 seconds later, which is what proves the scheduler (not
 * the queue) is the driver.
 *
 * NOT responsible for deciding when auto-merge is exhausted
 * (`auto-merge-exhaustion`), for notifying the user (the watcher already sends
 * an `auto_merge_exhausted` notification at park time), or for completing the
 * task once a human lands the PR — the park deliberately leaves
 * `status`/`workflowStatus` untouched so the task remains a watcher candidate
 * and completes through the ordinary merge path if the PR's head moves.
 */
import type { PrismaClient } from '../../generated/prisma-postgres';
import { createLogger } from '../../config/logger';
import { readExhaustionRecord } from './auto-merge-exhaustion';
import { recordTransition } from './transition-recorder';
import { logCycleEvent } from '../observability';

const log = createLogger('workflow:merge-exhausted-handoff');

/**
 * Transition cause recorded when a task is handed to the operator because its
 * auto-merge candidate is parked exhausted. Distinct from
 * `auto_merge_exhausted` (the watcher's own park, which says nothing about the
 * task row) and from `auto_run_hang_backstop` (a wedged AGENT, which
 * force-stops and reverts — wrong here, because the work is committed and
 * pushed and a hang verdict would make it work to redo).
 */
export const MERGE_OPERATOR_HANDOFF_CAUSE = 'auto_merge_operator_handoff';

/** Task.status values that still take part in auto-run selection. */
const SELECTABLE_STATUSES = new Set(['todo', 'in-progress', 'in_progress']);

/** The task fields {@link needsOperatorMergeHandoff} judges. */
export interface MergeHandoffState {
  /** `Task.status`. / タスクの状態 */
  status: string | null;
  /** `Task.workflowStatus`. / ワークフロー状態 */
  workflowStatus: string | null;
  /** `Task.autoRunExcluded` — already parked means nothing left to do. / 既に選定除外済みか */
  autoRunExcluded: boolean;
  /** Whether the auto-merge candidate is parked exhausted. / 自動マージが枯渇で停止中か */
  exhausted: boolean;
}

/**
 * Whether this task must be handed to the operator right now.
 *
 * Pure so the condition can be tested without a database: every clause is a
 * reason the scheduler would otherwise spin. `verify_done` is required because
 * that is the only state `workflowSettled` defers on; a task anywhere else
 * still has a phase the scheduler can legitimately dispatch.
 *
 * @param s - The task's current state. / タスクの現状
 * @returns True when the task should be parked for the operator. / 運用者へ引き渡すべきなら true
 */
export function needsOperatorMergeHandoff(s: MergeHandoffState): boolean {
  if (!s.exhausted) return false;
  if (s.workflowStatus !== 'verify_done') return false;
  if (!SELECTABLE_STATUSES.has(s.status ?? '')) return false;
  return !s.autoRunExcluded;
}

/**
 * Park a task whose auto-merge is exhausted so auto-run stops re-selecting it.
 *
 * Writes `autoRunExcluded` and nothing else. The write is a compare-and-swap
 * on the same shape the predicate judged, so a task another path completed,
 * blocked or already parked between the read and the write is left alone
 * rather than parked on stale evidence.
 *
 * Fails CLOSED in the sense that matters here: any read error yields `false`
 * ("not a handoff"), which leaves today's behaviour — the deferral — in place.
 * A lookup problem must never park a task that is legitimately mid-merge.
 *
 * @param prisma - Prisma client. / Prismaクライアント
 * @param taskId - Task currently tracked by the theme. / 対象タスクID
 * @param themeId - Theme the task belongs to, for the cycle log. / テーマID
 * @returns True when this call parked the task. / 本呼び出しで選定除外した場合 true
 */
export async function handOffExhaustedMerge(
  prisma: PrismaClient,
  taskId: number,
  themeId: number,
): Promise<boolean> {
  const task = await prisma.task
    .findUnique({
      where: { id: taskId },
      select: { status: true, workflowStatus: true, autoRunExcluded: true },
    })
    .catch(() => null);
  if (!task) return false;

  // Cheapest clauses first: skip the exhaustion read entirely for the ordinary
  // case (a task that is not even parked at verify_done), since this runs on
  // the scheduler's tick.
  if (
    !needsOperatorMergeHandoff({
      status: task.status,
      workflowStatus: task.workflowStatus,
      autoRunExcluded: task.autoRunExcluded,
      exhausted: true,
    })
  )
    return false;

  const record = await readExhaustionRecord(prisma, taskId);
  if (!record.exhausted) return false;

  const parked = await prisma.task
    .updateMany({
      where: { id: taskId, workflowStatus: 'verify_done', autoRunExcluded: false },
      data: { autoRunExcluded: true, updatedAt: new Date() },
    })
    .catch((err) => {
      log.warn({ err, taskId }, '[merge-exhausted-handoff] Park write failed');
      return { count: 0 };
    });
  if (parked.count === 0) return false;

  await recordTransition({
    taskId,
    fromStatus: task.workflowStatus,
    toStatus: task.workflowStatus ?? 'verify_done',
    actor: 'system',
    cause: MERGE_OPERATOR_HANDOFF_CAUSE,
    phase: 'verify',
    metadata: {
      reason: 'auto_merge_exhausted_no_owner',
      exhaustedAt: record.exhaustedAt?.toISOString() ?? null,
      headSha: record.headSha,
    },
  }).catch(() => {});

  logCycleEvent('task.skipped', {
    theme: themeId,
    task: taskId,
    cause: 'merge_exhausted_operator_handoff',
    msg: 'auto-merge exhausted with no owner — parked for the operator',
  });
  log.warn(
    { taskId, themeId, exhaustedAt: record.exhaustedAt, headSha: record.headSha },
    '[merge-exhausted-handoff] Auto-merge is exhausted and nothing owns this task — excluded from auto-run selection so the theme can proceed. A human must land or fix the PR.',
  );
  return true;
}
