/**
 * Current Active Task IDs
 *
 * Resolves which task IDs currently have a LIVE execution (worker process or
 * main-process auto-run orchestrator), so callers can avoid double-counting a
 * task's stale `interrupted` row alongside its fresh running one. Not
 * responsible for deciding resumability — see resumable-execution-policy.ts.
 */
import { prisma } from '../../../config/database';
import { orchestrator } from '../../core/orchestrator-instance';

/**
 * Union of execution IDs the worker subprocess and the main-process
 * auto-run orchestrator both consider currently active. Manual executions run
 * in the worker; auto-run/workflow executions run in the main process — a
 * task can only be considered "live" by checking both.
 *
 * The workflow runner registers an item as active before its agent has an execution
 * row, so a restart check that read only the lists above would see 0 while a phase was
 * starting. Such runner-only entries are added as the NEGATIVE task id (no execution id
 * exists yet; a negative never matches a real row), one per task, and only when no
 * live execution of that task is already counted.
 *
 * @returns Deduplicated list of currently active execution IDs / 現在アクティブな実行ID一覧
 */
export async function getCurrentActiveExecutionIds(): Promise<number[]> {
  const workerManager = orchestrator as unknown as {
    getActiveExecutionIdsAsync?: () => Promise<number[]>;
  };
  const workerActiveIds = workerManager.getActiveExecutionIdsAsync
    ? await workerManager.getActiveExecutionIdsAsync()
    : orchestrator.getActiveExecutions().map((e: { executionId: number }) => e.executionId);

  const { AgentOrchestrator } = await import('../agent-orchestrator');
  const mainActiveIds = AgentOrchestrator.getInstance(prisma)
    .getActiveAgentInfos()
    .map((i: { executionId: number }) => i.executionId);

  const ids = Array.from(new Set([...workerActiveIds, ...mainActiveIds]));
  const runnerOnly = await getRunnerOnlyTaskIds(ids);
  return [...ids, ...runnerOnly.map((taskId) => -taskId)];
}

/** Tasks the workflow runner has registered that no counted execution covers yet. */
async function getRunnerOnlyTaskIds(countedExecutionIds: number[]): Promise<number[]> {
  const { WorkflowRunner } = await import('../../workflow/workflow-runner');
  // The ledger holds every advance, including direct ones that have no queue item.
  const { getLedgerTaskIds } =
    await import('../../scheduling/auto-restart-merged-code/execution-ledger');
  const registered = Array.from(
    new Set([...WorkflowRunner.getInstance().getActiveTaskIds(), ...getLedgerTaskIds()]),
  );
  if (registered.length === 0) return [];
  const covered = await getLiveTaskIdsForActiveExecutions(countedExecutionIds);
  return registered.filter((taskId) => !covered.has(taskId));
}

/**
 * Resolves task IDs that have at least one `running`/`waiting_for_input`
 * execution among the given (currently active) execution IDs. Deliberately
 * has no `take` limit — dedup correctness must not depend on a display page
 * size.
 *
 * @param activeExecutionIds - Execution IDs considered live / 現在アクティブな実行ID一覧
 * @returns Set of task IDs with a live execution / ライブ実行を持つタスクID集合
 */
export async function getLiveTaskIdsForActiveExecutions(
  activeExecutionIds: number[],
): Promise<Set<number>> {
  if (activeExecutionIds.length === 0) return new Set();

  const liveExecutions = await prisma.agentExecution.findMany({
    where: {
      status: { in: ['running', 'waiting_for_input'] },
      id: { in: activeExecutionIds },
    },
    select: { session: { select: { config: { select: { task: { select: { id: true } } } } } } },
  });

  const liveTaskIds = new Set<number>();
  for (const execution of liveExecutions) {
    const taskId = execution.session.config?.task?.id;
    if (taskId != null) liveTaskIds.add(taskId);
  }
  return liveTaskIds;
}
