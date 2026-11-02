/**
 * Role Model Outcomes Query
 *
 * Reads which model ran each workflow phase and what the task did afterwards,
 * so a model choice can be judged on the repair loop rather than on whether
 * the CLI exited. Owns the database access only; the scoring is pure and
 * lives in role-model-outcomes-scoring.ts.
 */
import { prisma } from '../../../../../config/database';
import { attributeIncrementalCosts } from '../../../../../services/agents/execution-cost-attribution';
import {
  summariseCombinations,
  summariseRoleModels,
  type CombinationCell,
  type ExecutionRow,
  type RoleModelCell,
  type TaskOutcome,
} from './role-model-outcomes-scoring';

/** Transition causes that mean the work came back for repair. */
const BOUNCE_CAUSES = ['verify_repair', 'ci_repair'];

/** Causes that prove a task got far enough to have an outcome at all. */
const OUTCOME_CAUSES = [...BOUNCE_CAUSES, 'file_saved:verify', 'verify_review_admitted'];

/**
 * Workflow role behind a session mode (`workflow-implementer` → `implementer`).
 *
 * NOTE: cost-optimization-suggestions.ts keeps its own copy of this mapping.
 * The `workflow-` prefix is a stable convention, so two readers are cheaper
 * than an export every `mock.module` of that file would have to mirror.
 */
function workflowRole(mode: string | null | undefined): string | null {
  if (!mode?.startsWith('workflow-')) return null;
  return mode.slice('workflow-'.length).trim() || null;
}

/** What the endpoint returns. */
export interface RoleModelOutcomes {
  sinceDays: number;
  /** Tasks whose outcome is known and which had at least one phase in window. */
  tasksScored: number;
  /** Tasks skipped because they are still in flight. */
  tasksInFlight: number;
  roleModels: RoleModelCell[];
  /** The pairing the question is usually about: who implemented, who verified. */
  implementerVerifier: CombinationCell[];
  /** The full research → plan → implement → verify assignment. */
  fullPipeline: CombinationCell[];
}

/**
 * Score each phase's model against the repair loop over a recent window.
 *
 * Costs are attributed per execution before scoring. `AgentExecution.costUsd`
 * holds the CLI's session-cumulative total, so a plain sum counts every
 * resumed repair cycle again (measured 5.59x on one task) — the rows are
 * walked as chains exactly as the task budget walks them, and a chain that
 * began before the window is walked from its start so its pre-window spend is
 * not dragged in.
 *
 * @param args.days - Window length in days / 集計期間（日）
 * @returns Per-role-model and per-combination records / role×model と組み合わせの集計
 */
export async function getRoleModelOutcomes(args: { days: number }): Promise<RoleModelOutcomes> {
  const days = Math.min(90, Math.max(1, args.days));
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const inWindow = await prisma.agentExecution.findMany({
    where: { createdAt: { gte: since } },
    select: { session: { select: { config: { select: { taskId: true } } } } },
  });
  const taskIds = [
    ...new Set(
      inWindow
        .map((e) => e.session?.config?.taskId)
        .filter((id): id is number => typeof id === 'number'),
    ),
  ];
  if (taskIds.length === 0) {
    return {
      sinceDays: days,
      tasksScored: 0,
      tasksInFlight: 0,
      roleModels: [],
      implementerVerifier: [],
      fullPipeline: [],
    };
  }

  // Every row of those tasks, not just the in-window rows: a cost chain has to
  // be walked from its start for the increments to be right.
  const rows = await prisma.agentExecution.findMany({
    where: { session: { config: { taskId: { in: taskIds } } } },
    select: {
      costUsd: true,
      claudeSessionId: true,
      startedAt: true,
      modelName: true,
      executionTimeMs: true,
      session: { select: { mode: true, config: { select: { taskId: true } } } },
    },
    orderBy: { startedAt: 'asc' },
  });
  const increments = attributeIncrementalCosts(rows);

  const executions: ExecutionRow[] = [];
  rows.forEach((row, index) => {
    const taskId = row.session?.config?.taskId;
    if (typeof taskId !== 'number') return;
    // Rows with no start count as in-window: they are about to run, not old.
    if (row.startedAt && row.startedAt < since) return;
    executions.push({
      taskId,
      role: workflowRole(row.session?.mode),
      model: row.modelName ?? null,
      attributedCostUsd: increments[index],
      executionTimeMs: row.executionTimeMs ?? null,
      startedAt: row.startedAt ?? null,
    });
  });

  const transitions = await prisma.workflowTransition.findMany({
    where: { taskId: { in: taskIds } },
    select: { taskId: true, cause: true },
  });
  const bounces = new Map<number, number>();
  const reached = new Set<number>();
  for (const t of transitions) {
    if (BOUNCE_CAUSES.includes(t.cause)) bounces.set(t.taskId, (bounces.get(t.taskId) ?? 0) + 1);
    if (OUTCOME_CAUSES.includes(t.cause)) reached.add(t.taskId);
  }

  const tasks = await prisma.task.findMany({
    where: { id: { in: taskIds } },
    select: { id: true, workflowStatus: true },
  });
  const outcomes: TaskOutcome[] = [];
  let inFlight = 0;
  for (const task of tasks) {
    const done = task.workflowStatus === 'completed';
    // A task that has not yet reached verification has no bounce count to
    // give. Counting it as zero bounces would make every task still in
    // research evidence for the model that started it.
    if (!done && !reached.has(task.id)) {
      inFlight += 1;
      continue;
    }
    outcomes.push({ taskId: task.id, bounces: bounces.get(task.id) ?? 0, completed: done });
  }

  return {
    sinceDays: days,
    tasksScored: outcomes.length,
    tasksInFlight: inFlight,
    roleModels: summariseRoleModels(executions, outcomes),
    implementerVerifier: summariseCombinations(executions, outcomes, ['implementer', 'verifier']),
    fullPipeline: summariseCombinations(executions, outcomes, [
      'researcher',
      'planner',
      'implementer',
      'verifier',
    ]),
  };
}
