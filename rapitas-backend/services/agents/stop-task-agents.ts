/**
 * stop-task-agents
 *
 * Single source of truth for halting in-flight agent executions. Used by the
 * manual stop route, the theme auto-run scheduler, and the workflow runner so a
 * stop reliably kills EVERY agent — not just the first one found (the
 * duplicate-agent bug killed only one and left the rest running).
 */

import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import { AgentWorkerManager } from './agent-worker-manager';
import { AgentOrchestrator } from './agent-orchestrator';
import { releaseTaskExecutionLock } from './task-execution-lock';

const log = createLogger('stop-task-agents');

/** Execution statuses that represent an agent that is still alive. */
const ACTIVE_EXECUTION_STATUSES = ['running', 'pending', 'waiting_for_input'] as const;

export interface StopTaskAgentsResult {
  /** Number of agent executions that were asked to stop. / 停止要求した実行数 */
  stoppedCount: number;
  /** IDs of the executions that were stopped. / 停止した実行ID一覧 */
  executionIds: number[];
}

/**
 * Stop a set of agent executions and mark them cancelled.
 *
 * CRITICAL: an execution may be owned by EITHER orchestrator:
 *  - the worker-process orchestrator (manual execute-route → AgentWorkerManager
 *    → IPC → worker), or
 *  - the MAIN-process AgentOrchestrator (the workflow / auto-run path:
 *    workflow-cli-executor calls `AgentOrchestrator.getInstance(prisma)`
 *    directly, so the CLI child is owned by the main process).
 * The worker reports "no active execution" for a main-process execution and
 * vice-versa, so we MUST ask BOTH. Whichever owns it actually kills the spawned
 * CLI; the other no-ops. Asking only the worker was why a stopped auto-run kept
 * streaming agent output (the main-process CLI was never killed).
 *
 * @param executionIds - Execution IDs to stop. / 停止する実行ID
 * @param reason - Reason recorded on the cancelled executions. / キャンセル理由
 * @returns IDs actually processed. / 実際に処理したID
 */
async function stopExecutions(executionIds: number[], reason: string): Promise<number[]> {
  const agentWorkerManager = AgentWorkerManager.getInstance();
  const mainOrchestrator = AgentOrchestrator.getInstance(prisma);
  const done: number[] = [];
  for (const executionId of executionIds) {
    try {
      // Ask BOTH orchestrators — only the owner can taskkill the CLI handle.
      await agentWorkerManager.stopExecution(executionId).catch(() => false);
      await mainOrchestrator.stopExecution(executionId).catch(() => false);
      await prisma.agentExecutionLog.deleteMany({ where: { executionId } }).catch(() => {});
      await prisma.agentExecution
        .update({
          where: { id: executionId },
          data: { status: 'cancelled', completedAt: new Date(), errorMessage: reason },
        })
        .catch(() => {});
      done.push(executionId);
    } catch (err) {
      log.error({ err, executionId }, '[stopTaskAgents] Failed to stop execution');
    }
  }
  return done;
}

/**
 * Find all ACTIVE agent execution IDs for the given tasks.
 *
 * @param taskIds - Task IDs whose executions to find. / 対象タスクID
 * @returns Active execution IDs. / アクティブな実行ID
 */
async function findActiveExecutionIds(taskIds: number[]): Promise<number[]> {
  if (taskIds.length === 0) return [];
  const executions = await prisma.agentExecution
    .findMany({
      where: {
        session: { config: { taskId: { in: taskIds } } },
        status: { in: [...ACTIVE_EXECUTION_STATUSES] },
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    })
    .catch((err) => {
      log.warn({ err, taskIds }, '[stopTaskAgents] Failed to query active executions');
      return [] as { id: number }[];
    });
  return executions.map((e) => e.id);
}

/**
 * Stop ALL active agent executions for a task and mark them cancelled.
 *
 * The task execution lock is always released at the end so the task can be
 * re-run afterwards.
 *
 * @param taskId - The task whose agents should be stopped. / 停止対象タスクID
 * @param opts.errorMessage - Reason recorded on the cancelled executions. / キャンセル理由
 * @returns Count and IDs of the executions stopped. / 停止した実行の件数とID
 */
export async function stopTaskAgents(
  taskId: number,
  opts: { errorMessage?: string } = {},
): Promise<StopTaskAgentsResult> {
  const reason = opts.errorMessage ?? 'Cancelled';
  const ids = await findActiveExecutionIds([taskId]);
  const executionIds = await stopExecutions(ids, reason);

  // Release the mutex unconditionally — even when no execution row was found,
  // a leaked lock must not strand the task.
  releaseTaskExecutionLock(taskId);

  if (executionIds.length > 0) {
    log.info(
      { taskId, executionIds },
      `[stopTaskAgents] Stopped ${executionIds.length} execution(s)`,
    );
  }
  return { stoppedCount: executionIds.length, executionIds };
}

/**
 * Stop EVERY active agent execution that belongs to a theme's auto-run: the
 * current task, all of its subtasks, every task in the theme, and those tasks'
 * subtasks. This guarantees a theme stop leaves no orphaned agent running (e.g.
 * a split parent whose subtask agent runs under a different taskId).
 *
 * @param themeId - The theme being stopped. / 停止対象テーマID
 * @param currentTaskId - The currently tracked task (may be null). / 現在のタスクID
 * @param opts.errorMessage - Reason recorded on the cancelled executions. / キャンセル理由
 * @returns Count and IDs of the executions stopped. / 停止した実行の件数とID
 */
export async function stopThemeAgents(
  themeId: number,
  currentTaskId: number | null,
  opts: { errorMessage?: string } = {},
): Promise<StopTaskAgentsResult> {
  const reason = opts.errorMessage ?? 'Auto-run stopped';

  const taskIds = new Set<number>();
  if (currentTaskId) taskIds.add(currentTaskId);

  // All top-level tasks in the theme.
  const themeTasks = await prisma.task
    .findMany({ where: { themeId }, select: { id: true } })
    .catch(() => [] as { id: number }[]);
  for (const t of themeTasks) taskIds.add(t.id);

  // All subtasks of those tasks (and of the current task). Subtasks run under
  // their own taskId, so the per-task query above would miss them.
  const parentIds = [...taskIds];
  if (parentIds.length > 0) {
    const subtasks = await prisma.task
      .findMany({ where: { parentId: { in: parentIds } }, select: { id: true } })
      .catch(() => [] as { id: number }[]);
    for (const s of subtasks) taskIds.add(s.id);
  }

  const ids = await findActiveExecutionIds([...taskIds]);
  const executionIds = await stopExecutions(ids, reason);

  // Release locks for every task we may have been running.
  for (const taskId of taskIds) releaseTaskExecutionLock(taskId);

  if (executionIds.length > 0) {
    log.info(
      { themeId, executionIds },
      `[stopThemeAgents] Stopped ${executionIds.length} execution(s) across ${taskIds.size} task(s)`,
    );
  }
  return { stoppedCount: executionIds.length, executionIds };
}
