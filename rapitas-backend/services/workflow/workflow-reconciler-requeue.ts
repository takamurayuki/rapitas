/**
 * workflow-reconciler-requeue
 *
 * Recovery heals that put a stranded task back on the auto-run path: orphaned
 * in-progress tasks, bounded blocked-task retries, and undispatchable
 * status/workflowStatus desyncs. Called only from the workflow-reconciler's
 * periodic pass — NOT responsible for scheduling or detection cadence.
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { recordTransition } from './transition-recorder';

const log = createLogger('workflow-reconciler');

/** Execution statuses that represent a still-alive agent. */
export const ACTIVE_EXEC = ['running', 'pending', 'waiting_for_input'];

/** An in-progress task idle this long with no live execution is surfaced. */
export const STALE_TASK_MS = 45 * 60 * 1000;

/** Don't re-queue orphans older than this — ancient ones are likely abandoned. */
const MAX_ORPHAN_REQUEUE_AGE_MS = 2 * 24 * 60 * 60 * 1000;
/** Re-queue an orphan at most this many times before leaving it for notification. */
const MAX_ORPHAN_REQUEUE = 2;
/**
 * Auto-retry a BLOCKED task at most this many times before leaving it blocked for
 * the user. Blocked auto-created tasks otherwise sit forever, holding the backlog
 * promotion cap and starving the loop (observed: 5 blocked tasks = cap 5 → idle
 * with 20 open concerns un-promoted). A bounded retry re-runs them — most were
 * blocked by a since-fixed bug and now pass; genuine failures exhaust the budget
 * and stay blocked. / blocked タスクの自動再試行上限。
 */
const MAX_BLOCKED_RETRY = 2;
/**
 * Wait this long after a task was blocked before auto-retrying — let the dust
 * settle (don't race the run that just blocked it) and avoid hammering a task
 * that re-blocks instantly. / blocked 後この時間待ってから再試行。
 */
const BLOCKED_RETRY_SETTLE_MS = 3 * 60 * 1000;
/**
 * A todo task must sit in an undispatchable workflowStatus this long before the
 * reconciler resets it — long enough that no legitimate in-flight completion
 * (auto-commit, PR creation, staged completion) could still be settling.
 */
const UNDISPATCHABLE_SETTLE_MS = 24 * 60 * 60 * 1000;

/** True when the task still has a live agent execution. */
async function hasLiveExecution(taskId: number): Promise<boolean> {
  const live = await prisma.agentExecution
    .findFirst({
      where: { session: { config: { taskId } }, status: { in: ACTIVE_EXEC } },
      select: { id: true },
    })
    .catch(() => null);
  return !!live;
}

/**
 * Orphan recovery: re-queue a genuinely-stuck in-progress task (no live agent,
 * stale, non-terminal workflowStatus) back to 'todo' so auto-run reruns it.
 * Guards: skips completed (healed elsewhere) and awaiting_question (paused),
 * skips ANCIENT orphans (likely abandoned), and caps re-queues so an orphan that
 * keeps dying isn't requeued forever — after the cap, flagOrphanTasks notifies.
 *
 * @param nowMs - Current time (ms). / 現在時刻
 * @returns Number of tasks re-queued. / 再キュー数
 */
export async function requeueOrphanTasks(nowMs: number): Promise<number> {
  const staleBefore = new Date(nowMs - STALE_TASK_MS);
  const notOlderThan = new Date(nowMs - MAX_ORPHAN_REQUEUE_AGE_MS);
  const tasks = await prisma.task
    .findMany({
      where: {
        status: 'in-progress',
        parentId: null,
        updatedAt: { lt: staleBefore, gt: notOlderThan },
      },
      select: { id: true, title: true, workflowStatus: true },
    })
    .catch(() => [] as { id: number; title: string; workflowStatus: string | null }[]);

  let requeued = 0;
  for (const t of tasks) {
    if (t.workflowStatus === 'completed' || t.workflowStatus === 'awaiting_question') continue;
    if (await hasLiveExecution(t.id)) continue;

    const attempts = await prisma.workflowTransition
      .count({ where: { taskId: t.id, cause: 'reconciler_requeue' } })
      .catch(() => 0);
    if (attempts >= MAX_ORPHAN_REQUEUE) continue;

    await prisma.task
      .update({ where: { id: t.id }, data: { status: 'todo', updatedAt: new Date() } })
      .catch(() => {});
    await recordTransition({
      taskId: t.id,
      fromStatus: t.workflowStatus,
      toStatus: t.workflowStatus ?? 'draft',
      actor: 'system',
      cause: 'reconciler_requeue',
      metadata: { reason: 'orphan_in_progress_no_execution', attempt: attempts + 1 },
    }).catch(() => {});
    requeued++;
    log.info(
      { taskId: t.id, attempt: attempts + 1, wf: t.workflowStatus },
      '[reconciler] Re-queued orphaned in-progress task -> todo',
    );
  }
  return requeued;
}

/**
 * Self-healing for the perpetual loop: auto-retry BLOCKED auto-created tasks so a
 * since-fixed bug (the common cause — e.g. a verify-gate false-positive resolved
 * by a deploy) no longer strands them, and they stop permanently holding the
 * backlog-promotion cap. Bounded by MAX_BLOCKED_RETRY; only touches tasks whose
 * theme auto-run is still ARMED (enabled) so a user STOP is respected, and only
 * after a settle delay so we don't race the run that just blocked it.
 *
 * Reset to 'todo' + workflowStatus 'draft' (research/plan are reused via
 * isReusableArtifact, so the re-run is cheap) so the scheduler re-selects and
 * actually re-runs it rather than failing "cannot advance from <terminal>".
 *
 * @param nowMs - Current time (ms). / 現在時刻
 * @returns Number of tasks retried. / 再試行数
 */
export async function requeueBlockedTasks(nowMs: number): Promise<number> {
  const settleBefore = new Date(nowMs - BLOCKED_RETRY_SETTLE_MS);
  const notOlderThan = new Date(nowMs - MAX_ORPHAN_REQUEUE_AGE_MS);

  // Respect user stops: only retry blocked tasks in themes that are still armed.
  const armed = await prisma.themeAutoRun
    .findMany({ where: { enabled: true }, select: { themeId: true } })
    .catch(() => [] as { themeId: number }[]);
  const armedThemeIds = armed.map((a) => a.themeId);
  if (armedThemeIds.length === 0) return 0;

  // The verify->implement repair budget. A task that EXHAUSTED it is genuinely
  // failing verification — blindly re-queuing it just repeats the same doomed
  // implement→verify cycle. Such tasks need splitting / human attention, not
  // auto-retry. Read via cast (column pending client regen), matching
  // verify-self-repair's resolveMaxRepairs.
  const settings = (await prisma.userSettings.findFirst().catch(() => null)) as {
    verifyRepairLimit?: number | null;
  } | null;
  const verifyRepairLimit =
    typeof settings?.verifyRepairLimit === 'number' && settings.verifyRepairLimit > 0
      ? settings.verifyRepairLimit
      : 3;

  const tasks = await prisma.task
    .findMany({
      where: {
        status: 'blocked',
        parentId: null,
        themeId: { in: armedThemeIds },
        updatedAt: { lt: settleBefore, gt: notOlderThan },
      },
      select: { id: true, workflowStatus: true },
    })
    .catch(() => [] as { id: number; workflowStatus: string | null }[]);

  let retried = 0;
  for (const t of tasks) {
    // A live agent means it's not really stuck — skip.
    if (await hasLiveExecution(t.id)) continue;

    // Skip tasks PAUSED for the USER's answer. A blocked task whose workflowStatus
    // is 'awaiting_question' is not "stuck-blocked" — it is waiting for human input.
    // Auto-retrying it resets the workflow to draft, DESTROYS the pending question,
    // re-raises it, and loops (intake_question → blocked_auto_retry → intake_question
    // …, observed: task 363). It resumes via the answer-question endpoint, never a
    // blind retry — so leave it paused.
    if (t.workflowStatus === 'awaiting_question') continue;

    // Skip tasks that exhausted verify-repair — re-running repeats the same
    // failing implement→verify cycle (the task is too hard, needs splitting, not
    // blind retry). Count since the last manual retry so a user re-try grants a
    // fresh budget (mirrors verify-self-repair's countPriorRepairs).
    const lastRetry = await prisma.activityLog
      .findFirst({
        where: { taskId: t.id, action: 'task_retried' },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      })
      .catch(() => null);
    const repairs = await prisma.workflowTransition
      .count({
        where: {
          taskId: t.id,
          cause: 'verify_repair',
          ...(lastRetry ? { createdAt: { gt: lastRetry.createdAt } } : {}),
        },
      })
      .catch(() => 0);
    if (repairs >= verifyRepairLimit) {
      log.info(
        { taskId: t.id, repairs, verifyRepairLimit },
        '[reconciler] Blocked task exhausted verify-repair — leaving blocked (needs split/manual), not auto-retrying',
      );
      continue;
    }

    const attempts = await prisma.workflowTransition
      .count({ where: { taskId: t.id, cause: 'blocked_auto_retry' } })
      .catch(() => 0);
    if (attempts >= MAX_BLOCKED_RETRY) continue;

    await prisma.task
      .update({
        where: { id: t.id },
        data: { status: 'todo', workflowStatus: 'draft', updatedAt: new Date() },
      })
      .catch(() => {});
    await recordTransition({
      taskId: t.id,
      fromStatus: t.workflowStatus,
      toStatus: 'draft',
      actor: 'system',
      cause: 'blocked_auto_retry',
      metadata: { reason: 'blocked_task_auto_retry', attempt: attempts + 1 },
    }).catch(() => {});
    retried++;
    log.info(
      { taskId: t.id, attempt: attempts + 1, wf: t.workflowStatus },
      '[reconciler] Auto-retried blocked task -> todo (draft)',
    );
  }
  return retried;
}

/**
 * Heal undispatchable status/workflowStatus desyncs on todo tasks.
 *
 * Class 1 — todo × verify_done: `verify_done` has NO entry in the transition
 * table (completion runs inside the runner's post-verify handler, not via
 * advanceWorkflow), so such a task can never be dispatched: every auto-run
 * selection fails "ステータスでは次のフェーズを実行できません", burns the queue's
 * retries, and repeats on the next cycle forever (observed: tasks 5/8/11 parked
 * since May). Reset workflowStatus to 'draft' — research/plan/verify artifacts
 * are reused via isReusableArtifact, so the re-run is cheap and it completes
 * properly this time.
 *
 * Class 2 — todo × completed: the workflow finished but the task row's status
 * was never finalized (mirror of healCompletedDesync for the todo side).
 * Finalize to done so the scheduler stops re-selecting a finished task.
 *
 * Both classes require 24h staleness (no legitimate completion path takes that
 * long to settle, and a user's fresh manual re-run never sits 24h untouched)
 * and no live execution. Class 1 is additionally bounded to one reset per task.
 *
 * @param nowMs - Current time (ms). / 現在時刻
 * @returns Number of tasks healed. / 修復数
 */
export async function healUndispatchableTodo(nowMs: number): Promise<number> {
  const cutoff = new Date(nowMs - UNDISPATCHABLE_SETTLE_MS);
  let healed = 0;

  const stranded = await prisma.task
    .findMany({
      where: {
        status: 'todo',
        workflowStatus: 'verify_done',
        parentId: null,
        updatedAt: { lt: cutoff },
      },
      select: { id: true },
    })
    .catch(() => [] as { id: number }[]);
  for (const t of stranded) {
    if (await hasLiveExecution(t.id)) continue;
    const attempts = await prisma.workflowTransition
      .count({ where: { taskId: t.id, cause: 'reconciler_reset_undispatchable' } })
      .catch(() => 0);
    if (attempts >= 1) continue; // one reset per task — a re-strand needs a human look
    await prisma.task
      .update({
        where: { id: t.id },
        data: { workflowStatus: 'draft', updatedAt: new Date() },
      })
      .catch(() => {});
    await recordTransition({
      taskId: t.id,
      fromStatus: 'verify_done',
      toStatus: 'draft',
      actor: 'system',
      cause: 'reconciler_reset_undispatchable',
      metadata: { reason: 'todo_verify_done_has_no_transition' },
    }).catch(() => {});
    healed++;
    log.info(
      { taskId: t.id },
      '[reconciler] Reset undispatchable todo×verify_done task -> draft (artifacts reused on re-run)',
    );
  }

  const finished = await prisma.task
    .findMany({
      where: {
        status: 'todo',
        workflowStatus: 'completed',
        parentId: null,
        updatedAt: { lt: cutoff },
      },
      select: { id: true, completedAt: true },
    })
    .catch(() => [] as { id: number; completedAt: Date | null }[]);
  for (const t of finished) {
    if (await hasLiveExecution(t.id)) continue;
    await prisma.task
      .update({
        where: { id: t.id },
        data: { status: 'done', completedAt: t.completedAt ?? new Date() },
      })
      .catch(() => {});
    healed++;
    log.info(
      { taskId: t.id },
      '[reconciler] Healed completion desync (todo + wf=completed) -> done',
    );
  }

  return healed;
}
