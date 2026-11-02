/**
 * role-model-outcomes-scoring
 *
 * Scores each workflow phase's model by what the task did afterwards. Pure:
 * no database, no clock. The query that feeds it is in
 * role-model-outcomes-query.ts.
 *
 * Why not reuse the cost-optimization panel's grouping. It already buckets
 * executions by role and model, but scores them on `status === 'completed'` —
 * the CLI exiting cleanly. Measured 2026-10-21 over 500 executions that axis
 * is saturated (sonnet 100%, opus 98%, haiku 100%) and cannot distinguish two
 * models at all, which is exactly the question "would the cheaper model do
 * as well" needs answered. The repair loop does vary: 37 `verify_repair`
 * transitions against 59 verify saves in the same fortnight.
 *
 * Costs arrive already attributed per execution. `AgentExecution.costUsd`
 * holds the CLI's session-cumulative total, so summing it double-counts every
 * resumed repair cycle (measured 5.59x on one task); the caller runs the rows
 * through the same increment attribution the budget uses.
 */

/** Smallest number of tasks a cell will report a rate from. */
export const MIN_TASKS_FOR_RATE = 10;

/** One execution, reduced to what scoring needs. */
export interface ExecutionRow {
  taskId: number;
  /** Workflow role, from the session's mode. */
  role: string | null;
  model: string | null;
  /** This execution's own cost, not its session's running total. */
  attributedCostUsd: number;
  executionTimeMs: number | null;
  startedAt: Date | null;
}

/** What a task did after its phases ran. */
export interface TaskOutcome {
  taskId: number;
  /** `verify_repair` + `ci_repair` transitions — the repair loop's cost. */
  bounces: number;
  completed: boolean;
}

/** One (role, model) pair's record. */
export interface RoleModelCell {
  role: string;
  model: string;
  executions: number;
  tasks: number;
  firstPassTasks: number;
  /** Share of tasks that never bounced; null below MIN_TASKS_FOR_RATE. */
  firstPassRate: number | null;
  /** Mean bounces per task; null below MIN_TASKS_FOR_RATE. */
  meanBounces: number | null;
  medianDurationMs: number | null;
  costUsd: number;
}

/** One combination of phases, each run by a named model. */
export interface CombinationCell {
  /** Role to the model that finished that phase. */
  models: Record<string, string>;
  tasks: number;
  firstPassTasks: number;
  firstPassRate: number | null;
  meanBounces: number | null;
  costUsd: number;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/** Sort key for "which execution finished this phase"; unstarted rows last. */
function startedMs(row: ExecutionRow): number {
  return row.startedAt ? row.startedAt.getTime() : Number.MAX_SAFE_INTEGER;
}

/**
 * Group executions by role and model, scored by their tasks' outcomes.
 *
 * Rows with no role or no model are dropped rather than bucketed as
 * "unknown": 8 of 500 measured executions recorded no model, and inventing a
 * model that never ran would put real outcomes behind a label.
 *
 * @param rows - Executions in the window / 対象期間の実行
 * @param outcomes - Outcome per task, for tasks whose outcome is known / タスクの結果
 * @returns One cell per (role, model), thickest evidence first / role×model の集計
 */
export function summariseRoleModels(
  rows: readonly ExecutionRow[],
  outcomes: readonly TaskOutcome[],
): RoleModelCell[] {
  const byTask = new Map(outcomes.map((o) => [o.taskId, o]));
  const cells = new Map<
    string,
    {
      role: string;
      model: string;
      executions: number;
      durations: number[];
      cost: number;
      tasks: Set<number>;
    }
  >();

  for (const row of rows) {
    if (!row.role || !row.model) continue;
    // A task still running has no bounce count. Treating it as zero bounces
    // would make every in-flight task evidence for the model that started it.
    if (!byTask.has(row.taskId)) continue;
    const key = `${row.role}\u0000${row.model}`;
    const cell = cells.get(key) ?? {
      role: row.role,
      model: row.model,
      executions: 0,
      durations: [] as number[],
      cost: 0,
      tasks: new Set<number>(),
    };
    cell.executions += 1;
    cell.cost += row.attributedCostUsd;
    if (typeof row.executionTimeMs === 'number') cell.durations.push(row.executionTimeMs);
    cell.tasks.add(row.taskId);
    cells.set(key, cell);
  }

  return [...cells.values()]
    .map((cell) => {
      const taskOutcomes = [...cell.tasks].map((id) => byTask.get(id)!);
      const firstPassTasks = taskOutcomes.filter((o) => o.bounces === 0).length;
      const thick = taskOutcomes.length >= MIN_TASKS_FOR_RATE;
      return {
        role: cell.role,
        model: cell.model,
        executions: cell.executions,
        tasks: taskOutcomes.length,
        firstPassTasks,
        firstPassRate: thick ? firstPassTasks / taskOutcomes.length : null,
        meanBounces: thick
          ? taskOutcomes.reduce((n, o) => n + o.bounces, 0) / taskOutcomes.length
          : null,
        medianDurationMs: median(cell.durations),
        costUsd: cell.cost,
      };
    })
    .sort((a, b) => b.tasks - a.tasks || b.executions - a.executions);
}

/**
 * Group tasks by the combination of models that ran the named roles.
 *
 * The LAST execution of a role wins: a phase that timed out and was
 * re-dispatched has more than one, and the phase's output came from the model
 * that finished it. A task missing any named role is dropped — a combination
 * is a claim about all of those phases together, and filling a gap with
 * whatever else ran would attribute the outcome to a model that never had it.
 *
 * @param rows - Executions in the window / 対象期間の実行
 * @param outcomes - Outcome per task / タスクの結果
 * @param roles - Roles the combination is made of / 組み合わせ対象のrole
 * @returns One cell per combination, thickest evidence first / 組み合わせ別の集計
 */
export function summariseCombinations(
  rows: readonly ExecutionRow[],
  outcomes: readonly TaskOutcome[],
  roles: readonly string[],
): CombinationCell[] {
  const byTask = new Map(outcomes.map((o) => [o.taskId, o]));
  const perTask = new Map<number, Map<string, ExecutionRow>>();

  for (const row of rows) {
    if (!row.role || !row.model || !roles.includes(row.role)) continue;
    if (!byTask.has(row.taskId)) continue;
    const taskRoles = perTask.get(row.taskId) ?? new Map<string, ExecutionRow>();
    const held = taskRoles.get(row.role);
    if (!held || startedMs(row) >= startedMs(held)) taskRoles.set(row.role, row);
    perTask.set(row.taskId, taskRoles);
  }

  const cells = new Map<
    string,
    { models: Record<string, string>; tasks: TaskOutcome[]; cost: number }
  >();
  for (const [taskId, taskRoles] of perTask) {
    if (roles.some((role) => !taskRoles.has(role))) continue;
    const models: Record<string, string> = {};
    let cost = 0;
    for (const role of roles) {
      const row = taskRoles.get(role)!;
      models[role] = row.model as string;
    }
    for (const row of rows) {
      if (row.taskId === taskId) cost += row.attributedCostUsd;
    }
    const key = roles.map((role) => `${role}=${models[role]}`).join('|');
    const cell = cells.get(key) ?? { models, tasks: [] as TaskOutcome[], cost: 0 };
    cell.tasks.push(byTask.get(taskId)!);
    cell.cost += cost;
    cells.set(key, cell);
  }

  return [...cells.values()]
    .map((cell) => {
      const firstPassTasks = cell.tasks.filter((o) => o.bounces === 0).length;
      const thick = cell.tasks.length >= MIN_TASKS_FOR_RATE;
      return {
        models: cell.models,
        tasks: cell.tasks.length,
        firstPassTasks,
        firstPassRate: thick ? firstPassTasks / cell.tasks.length : null,
        meanBounces: thick
          ? cell.tasks.reduce((n, o) => n + o.bounces, 0) / cell.tasks.length
          : null,
        costUsd: cell.cost,
      };
    })
    .sort((a, b) => b.tasks - a.tasks);
}
