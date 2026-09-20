/**
 * AutoRunExecutionPresence
 *
 * Answers whether a task has EVER had an AgentExecution. Used by the hang
 * backstop to tell "waiting its turn in the queue" (never executed) from
 * "started and wedged". Owns only that lookup; the wall guard stays in
 * auto-run-active-decision.
 */
import type { PrismaClient } from '../../../generated/prisma-postgres';
import { createLogger } from '../../../config/logger';

const log = createLogger('theme-auto-run-scheduler');

/**
 * Whether any AgentExecution (in any status) exists for the task.
 *
 * Same nested `session.config.taskId` filter as hasLiveExecution so it works
 * on both SQLite and PostgreSQL. Errors propagate to the caller.
 *
 * @param prisma - Prisma client. / Prisma クライアント
 * @param taskId - Task to check. / 確認対象タスク
 * @returns true when at least one execution exists. / 実行が1件でもあれば true
 * @throws When the lookup fails. / 照会に失敗した場合
 */
export async function hasAnyExecution(prisma: PrismaClient, taskId: number): Promise<boolean> {
  const row = await prisma.agentExecution.findFirst({
    where: { session: { config: { taskId } } },
    select: { id: true },
  });
  return row != null;
}

/**
 * True only when the lookup succeeded AND found zero executions.
 *
 * Fail-closed: a lookup error returns false (treated as "has run") so a DB
 * hiccup cannot disable the hang backstop for a genuinely wedged task.
 *
 * @param prisma - Prisma client. / Prisma クライアント
 * @param taskId - Task to check. / 確認対象タスク
 * @returns true when confirmed never executed. / 未実行が確認できた場合のみ true
 */
export async function taskNeverExecuted(prisma: PrismaClient, taskId: number): Promise<boolean> {
  try {
    return !(await hasAnyExecution(prisma, taskId));
  } catch (err) {
    log.warn(
      `[ThemeAutoRunScheduler] Task ${taskId} execution-presence lookup failed (${
        err instanceof Error ? err.message : String(err)
      }) — treating as executed, backstop stays armed`,
    );
    return false;
  }
}
