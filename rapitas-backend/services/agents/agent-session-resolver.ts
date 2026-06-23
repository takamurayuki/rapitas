/**
 * Agent Session Resolver
 *
 * Single source of truth for resolving AgentSession rows needed by execution
 * routes and workflow CLI executor. Not responsible for HTTP handling, business
 * logic, or session mutations.
 */
import type { Prisma } from '@prisma/client';
import { prisma } from '../../config/database';

/**
 * Minimal finished-session shape — only the id is needed to target a re-run.
 * Resolved from the most recent completed/failed/interrupted session for a config.
 */
export type LatestFinishedSession = Prisma.AgentSessionGetPayload<{
  select: { id: true };
}>;

/**
 * Session with its most recent execution — used for continue-execution to read
 * previous output and detect in-flight executions.
 */
export type SessionWithLatestExecution = Prisma.AgentSessionGetPayload<{
  include: { agentExecutions: { orderBy: { createdAt: 'desc' }; take: 1 } };
}>;

/**
 * Minimal session shape for worktree path resolution in CLI executor.
 * Only the two fields consulted before canReuseWorktree() / branch recreation.
 */
export type LatestSessionWorktree = Prisma.AgentSessionGetPayload<{
  select: { worktreePath: true; branchName: true };
}>;

/**
 * Resolve the most recent finished session for an agent config.
 * "Finished" means status is completed, failed, or interrupted.
 * Returns null when no matching session exists or a DB error occurs.
 *
 * @param configId - AgentSession.configId / エージェント設定ID
 * @returns Minimal session row with id, or null. / セッションID行、なければnull
 */
export async function resolveLatestFinishedSession(
  configId: number,
): Promise<LatestFinishedSession | null> {
  return prisma.agentSession
    .findFirst({
      where: {
        configId,
        status: { in: ['completed', 'failed', 'interrupted'] },
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    })
    .catch(() => null);
}

/**
 * Resolve a session with its most recent execution included.
 * Used by continue-execution to inspect the previous output and running state.
 * Returns null when the session is absent or a DB error occurs.
 *
 * @param sessionId - AgentSession primary key. / セッションの主キー
 * @returns Session with latest execution, or null. / 最新実行付きセッション、なければnull
 */
export async function resolveSessionWithLatestExecution(
  sessionId: number,
): Promise<SessionWithLatestExecution | null> {
  return prisma.agentSession
    .findUnique({
      where: { id: sessionId },
      include: { agentExecutions: { orderBy: { createdAt: 'desc' }, take: 1 } },
    })
    .catch(() => null);
}

/**
 * Resolve the most recent session that recorded a worktree path for a task.
 * Used by workflow-cli-executor to reuse an existing worktree for implementer/
 * verifier roles. Returns null when no worktree session exists or a DB error occurs.
 *
 * @param taskId - Task primary key. / タスクの主キー
 * @returns Minimal session with worktreePath and branchName, or null. / worktreePath/branchName行、なければnull
 */
export async function resolveLatestSessionWorktree(
  taskId: number,
): Promise<LatestSessionWorktree | null> {
  return prisma.agentSession
    .findFirst({
      where: {
        config: { taskId },
        worktreePath: { not: null },
      },
      orderBy: { createdAt: 'desc' },
      select: { worktreePath: true, branchName: true },
    })
    .catch(() => null);
}
