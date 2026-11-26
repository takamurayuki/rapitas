/**
 * auto-run-liveness
 *
 * Liveness reads the auto-run hang backstop and hold decisions share: whether a
 * task waits for a user's answer, when it last made progress, and whether it has
 * a live execution. Split out of auto-run-selection.ts (task 1552) to bring that
 * file under the size limit; auto-run-selection.ts re-exports every symbol here
 * so existing imports and mock.module mirrors keep working.
 * Not responsible for selecting tasks.
 */
import type { PrismaClient } from '../../../generated/prisma-postgres';
import { NOT_REVIEW_COST_ROW } from '../../agents/review-cost-rows';

/**
 * Whether a task is parked WAITING FOR A USER'S ANSWER, which
 * execute-post-handler stores as status 'blocked' — indistinguishable from a
 * real failure by status alone. Covers TWO distinct pause mechanisms:
 *  - a LIVE AskUserQuestion during an active session (most recent
 *    AgentExecution carries an unanswered `question`; once answered, a fresh
 *    execution with no question supersedes it), and
 *  - an intake/spec-clarification question.md saved via the Workflow API,
 *    which has no live session at all — its pause is recorded purely as
 *    `task.workflowStatus === 'awaiting_question'`. Missing this second case
 *    made the scheduler treat such a pause as a genuine failure, permanently
 *    parking the task at status 'blocked' even after the user answered (the
 *    answer only resets workflowStatus, not the stale 'blocked' status).
 * The scheduler uses this to HOLD (not advance) such a task, so it doesn't
 * treat the pause as a failure and spawn a second agent for the next task while
 * the answer-resume continues this one.
 *
 * @param prisma - Prisma client instance
 * @param taskId - Task to check / 確認対象タスク
 * @returns true when a live question or an intake question.md is pending / 未応答の質問（ライブまたはインテイク）があればtrue
 */
export async function isAwaitingUserAnswer(prisma: PrismaClient, taskId: number): Promise<boolean> {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    select: { workflowStatus: true },
  });
  if (task?.workflowStatus === 'awaiting_question') return true;

  const latest = await prisma.agentExecution.findFirst({
    where: { ...NOT_REVIEW_COST_ROW, session: { config: { taskId } } },
    orderBy: { createdAt: 'desc' },
    select: { question: true },
  });
  return latest?.question != null && latest.question !== '';
}

/** Heartbeat freshness window for the hang backstop's liveness check. */
export const HANG_BACKSTOP_HEARTBEAT_MS = 5 * 60_000;

/**
 * Newest evidence that the task is still moving: its tenure start, its latest
 * workflow transition, or the latest heartbeat of any of its executions.
 *
 * The hang backstop must measure time SINCE PROGRESS, not tenure. Tenure alone
 * kills healthy multi-phase work — the implementer's own wall-clock cap (56 min)
 * already exceeds the 45-minute task wall, and even the liveness exemption has a
 * hole at the phase seam: task 585 was force-stopped 8 seconds after its
 * implementer committed a full implementation, in the 30-second gap before the
 * verifier's execution row appeared, at 48 minutes of tenure.
 *
 * @param prisma - Prisma client instance
 * @param taskId - Task to inspect. / 対象タスク
 * @param tenureStart - Epoch ms the task became the current task. / 現行タスクになった時刻
 * @returns Epoch ms of the most recent progress signal. / 直近の進捗時刻(ms)
 */

/**
 * Whether the task has a LIVE agent execution — running with a heartbeat fresh
 * within {@link HANG_BACKSTOP_HEARTBEAT_MS}. Used by the hang backstop to tell
 * "slow but progressing" apart from "wedged": task 563's healthy 31-minute
 * implementer (heartbeat updating every minute) was force-stopped at the
 * 45-minute whole-task wall because tenure was the ONLY signal. A stale-
 * heartbeat running row (zombie) still reads as not-live so the backstop
 * keeps catching genuine hangs.
 *
 * @param prisma - Prisma client instance
 * @param taskId - Task to check / 確認対象タスク
 * @returns true when a fresh-heartbeat running execution exists / 生きた実行があればtrue
 */
export async function resolveLastProgressAt(
  prisma: PrismaClient,
  taskId: number,
  tenureStart: number,
): Promise<number> {
  const [lastTransition, lastBeat] = await Promise.all([
    prisma.workflowTransition
      .findFirst({ where: { taskId }, orderBy: { createdAt: 'desc' }, select: { createdAt: true } })
      .catch(() => null),
    prisma.agentExecution
      .findFirst({
        where: { session: { config: { taskId } }, heartbeatAt: { not: null } },
        orderBy: { heartbeatAt: 'desc' },
        select: { heartbeatAt: true },
      })
      .catch(() => null),
  ]);
  return Math.max(
    tenureStart,
    lastTransition?.createdAt?.getTime() ?? 0,
    lastBeat?.heartbeatAt?.getTime() ?? 0,
  );
}

/**
 * Whether the task has a LIVE agent execution — running with a heartbeat fresh
 * within {@link HANG_BACKSTOP_HEARTBEAT_MS}.
 *
 * @param prisma - Prisma client instance
 * @param taskId - Task to check / 確認対象タスク
 * @returns true when a fresh-heartbeat running execution exists / 生きた実行があればtrue
 */
export async function hasLiveExecution(prisma: PrismaClient, taskId: number): Promise<boolean> {
  const fresh = new Date(Date.now() - HANG_BACKSTOP_HEARTBEAT_MS);
  const live = await prisma.agentExecution
    .findFirst({
      where: {
        session: { config: { taskId } },
        status: 'running',
        heartbeatAt: { gte: fresh },
      },
      select: { id: true },
    })
    .catch(() => null);
  return live != null;
}
