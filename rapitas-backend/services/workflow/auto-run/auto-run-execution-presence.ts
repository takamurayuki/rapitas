/**
 * AutoRunExecutionPresence
 *
 * Answers whether a task has had an AgentExecution (optionally only since it
 * became the current task). Used by the hang backstop to tell "waiting its
 * turn in the queue" (not executed this tenure) from "started and wedged".
 * Owns only that lookup; the wall guard stays in auto-run-active-decision.
 */
import type { PrismaClient } from '../../../generated/prisma-postgres';
import { createLogger } from '../../../config/logger';

const log = createLogger('theme-auto-run-scheduler');

/**
 * Whether any AgentExecution exists for the task.
 *
 * Same nested `session.config.taskId` filter as hasLiveExecution so it works
 * on both SQLite and PostgreSQL. Errors propagate to the caller.
 *
 * @param prisma - Prisma client. / Prisma クライアント
 * @param taskId - Task to check. / 確認対象タスク
 * @param since - When set, only executions created at/after this instant count, plus any still-running one. / 指定時はこの時刻以降（と実行中）のみ数える
 * @returns true when a matching execution exists. / 該当する実行があれば true
 * @throws When the lookup fails. / 照会に失敗した場合
 */
export async function hasAnyExecution(
  prisma: PrismaClient,
  taskId: number,
  since?: Date,
): Promise<boolean> {
  const row = await prisma.agentExecution.findFirst({
    where: {
      session: { config: { taskId } },
      // A 'running' execution that predates `since` is still work in flight, not a queue wait.
      ...(since ? { OR: [{ createdAt: { gte: since } }, { status: 'running' }] } : {}),
    },
    select: { id: true },
  });
  return row != null;
}

/**
 * True only when the lookup succeeded AND found zero matching executions.
 *
 * Fail-closed: a lookup error returns false (treated as "has run") so a DB
 * hiccup cannot disable the hang backstop for a genuinely wedged task.
 *
 * @param prisma - Prisma client. / Prisma クライアント
 * @param taskId - Task to check. / 確認対象タスク
 * @param since - Start of the current tenure; omit to look at all history. / 現在タスク化した時刻（省略時は全履歴）
 * @returns true when confirmed never executed. / 未実行が確認できた場合のみ true
 */
export async function taskNeverExecuted(
  prisma: PrismaClient,
  taskId: number,
  since?: Date,
): Promise<boolean> {
  try {
    return !(await hasAnyExecution(prisma, taskId, since));
  } catch (err) {
    log.warn(
      `[ThemeAutoRunScheduler] Task ${taskId} execution-presence lookup failed (${
        err instanceof Error ? err.message : String(err)
      }) — treating as executed, backstop stays armed`,
    );
    return false;
  }
}
