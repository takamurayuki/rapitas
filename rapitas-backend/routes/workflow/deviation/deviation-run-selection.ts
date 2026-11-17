/**
 * deviation-run-selection
 *
 * Decides which runs of a task the deviation timeline judges, and against
 * which plan.md version. Each run is judged against the plan in force when it
 * started; runs sharing that plan are judged together, and the newest such
 * group that changed project files is chosen.
 *
 * Why (audit 2026-11-17): the timeline took the newest run with any recorded
 * operation, which is the verifier writing only its scratch file, and read the
 * current plan.md even after a replan had replaced the one the implementer
 * worked to — 42 of 42 judged tasks came out deviating.
 * Not responsible for classifying the operations (plan-deviation/classifier).
 */
import {
  isWorkflowScratchFile,
  type OperationRecord,
} from '../../../services/workflow/plan-deviation';
import type { DeviationDeps, ExecutionInfo, PlanVersion } from './deviation-deps';

/** The runs and plan one timeline is built from. */
export interface RunSelection {
  /** Runs judged together, newest first. */
  executions: ExecutionInfo[];
  /** Their operations, each tagged with the run that recorded it. */
  operations: OperationRecord[];
  warnings: string[];
  planContent: string | null;
}

/** Index of the plan version in force at `at`; the current plan when unknown. */
function planIndexAt(versions: PlanVersion[], at: Date | null | undefined): number {
  if (!at) return versions.length - 1;
  const i = versions.findIndex((v) => v.validUntil === null || v.validUntil > at);
  return i === -1 ? versions.length - 1 : i;
}

/**
 * Choose the runs and the plan version for a task's timeline.
 *
 * @param taskId - Task ID / タスクID
 * @param executions - The task's runs, newest first / タスクの実行（新しい順）
 * @param deps - Data access / 依存
 * @returns The runs judged together and their plan / 判定する実行と計画
 */
export async function selectRunsForTimeline(
  taskId: number,
  executions: ExecutionInfo[],
  deps: DeviationDeps,
): Promise<RunSelection> {
  const versions: PlanVersion[] = deps.readPlanVersions
    ? await deps.readPlanVersions(taskId)
    : [{ content: (await deps.readPlan(taskId)) ?? '', validUntil: null }];
  const current = versions.length > 0 ? versions[versions.length - 1].content : null;

  const groups = new Map<
    number,
    { executions: ExecutionInfo[]; ops: OperationRecord[]; warnings: string[] }
  >();
  const order: number[] = [];
  for (const e of executions) {
    const key = versions.length > 0 ? planIndexAt(versions, e.startedAt) : -1;
    if (!groups.has(key)) {
      groups.set(key, { executions: [], ops: [], warnings: [] });
      order.push(key);
    }
    const g = groups.get(key)!;
    const stored = deps.readOperations(e.id);
    g.executions.push(e);
    g.ops.push(...stored.operations.map((op) => ({ ...op, executionId: e.id })));
    g.warnings.push(...stored.warnings);
  }

  const changedFiles = (g: { executions: ExecutionInfo[]; ops: OperationRecord[] }) =>
    g.ops.some(
      (op) =>
        op.kind === 'file_change' &&
        !!op.features.path &&
        !isWorkflowScratchFile(
          op.features.path,
          g.executions.find((e) => e.id === op.executionId)?.worktreePath,
        ),
    );
  const key =
    order.find((k) => changedFiles(groups.get(k)!)) ??
    order.find((k) => groups.get(k)!.ops.length > 0) ??
    order[0];
  if (key === undefined) {
    return { executions: [], operations: [], warnings: [], planContent: current };
  }
  const chosen = groups.get(key)!;
  return {
    executions: chosen.executions,
    operations: chosen.ops,
    warnings: chosen.warnings,
    planContent: key >= 0 ? versions[key].content : current,
  };
}
