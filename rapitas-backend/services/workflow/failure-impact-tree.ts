/**
 * failure-impact-tree
 *
 * Builds the failure-propagation tree for a failed task: a root-cause
 * classification for the failed task itself, plus the subtask hierarchy
 * (`Task.parentId`) beneath it that inherits the failure's impact. Pure and
 * DB-independent — callers pass in plain task snapshots (already fetched via
 * Prisma) so the tree construction and cycle/missing-data handling are unit
 * testable without a database. Not responsible for retry strategy or
 * re-queue ordering (topological sort) — those are explicitly out of scope
 * for this task (idea #11177 minimal scope).
 */
import { classifyAgentError } from '../ai/agent-error-classifier';

/** Minimal task fact set this module needs — a subset of the Task row. */
export interface FailureTaskSnapshot {
  id: number;
  title: string;
  status: string;
  parentId: number | null;
  haltReason?: string | null;
  /** Most recent AgentExecution.errorMessage for this task, if any. */
  lastErrorMessage?: string | null;
}

/**
 * Normalized root-cause bucket. Kept to exactly these four values — this is
 * a coarse "root fix vs symptomatic fix" hint for the UI, not a full
 * diagnostic taxonomy.
 */
export type RootCauseCategory =
  | 'resource_exhaustion'
  | 'timeout'
  | 'external_api_error'
  | 'unclassified';

/** Root-cause classification result for the failed task. */
export interface RootCauseAnalysis {
  category: RootCauseCategory;
  /** One-line human-readable basis for the classification. */
  detail: string;
}

/** A single node in the failure-impact tree. */
export interface FailureImpactNode {
  taskId: number;
  title: string;
  status: string;
  /** Position relative to the failed task: itself, a direct child, or deeper. */
  relation: 'root' | 'direct' | 'indirect';
  /** Distance from the root node (root = 0). */
  depth: number;
  children: FailureImpactNode[];
}

/** Result of {@link buildFailureImpactTree}. */
export interface FailureImpactTreeResult {
  rootCause: RootCauseAnalysis;
  /** Null when the failed task itself could not be found in the input. */
  tree: FailureImpactNode | null;
  /** All descendant task ids affected by the failure (excludes the root). */
  affectedTaskIds: number[];
  /** Non-fatal issues encountered while building the tree (e.g. a cycle). */
  warnings: string[];
}

const HALT_REASON_CATEGORY: Record<string, RootCauseCategory> = {
  budget_time_exceeded: 'timeout',
  budget_cost_exceeded: 'resource_exhaustion',
};

/**
 * Classifies the root cause of a failed task from its halt reason and/or its
 * most recent agent execution error message. Halt reason is checked first —
 * it is a structured, already-decided classification on the Task row — then
 * the error message is run through the existing agent-error classifier as a
 * fallback signal.
 *
 * @param snapshot - The failed task's facts. / 失敗タスクの情報
 * @returns The normalized root-cause category and a one-line basis. / 分類結果
 */
export function classifyFailureRootCause(
  snapshot: Pick<FailureTaskSnapshot, 'haltReason' | 'lastErrorMessage'>,
): RootCauseAnalysis {
  const { haltReason, lastErrorMessage } = snapshot;

  if (haltReason && HALT_REASON_CATEGORY[haltReason]) {
    return {
      category: HALT_REASON_CATEGORY[haltReason],
      detail: `haltReason=${haltReason}`,
    };
  }

  if (lastErrorMessage) {
    const classified = classifyAgentError(lastErrorMessage);
    if (classified) {
      const category: RootCauseCategory =
        classified.reason === 'quota' || classified.reason === 'rate_limit'
          ? 'resource_exhaustion'
          : classified.reason === 'auth' ||
              classified.reason === 'transient' ||
              classified.reason === 'model_unavailable'
            ? 'external_api_error'
            : 'unclassified';
      return { category, detail: `errorReason=${classified.reason}` };
    }
  }

  if (haltReason) {
    return { category: 'unclassified', detail: `haltReason=${haltReason}` };
  }

  return { category: 'unclassified', detail: 'no haltReason or error message available' };
}

/**
 * Builds the failure-impact tree for a failed task: the task itself as the
 * root node, plus every descendant reachable via `parentId` (direct and
 * indirect subtasks). Handles a missing failed task (returns `tree: null`),
 * a single node with no subtasks, and cyclic `parentId` data (cuts the cycle
 * and records a warning instead of recursing forever).
 *
 * @param failedTaskId - The id of the task that failed. / 失敗タスクID
 * @param tasks - All candidate task snapshots to search for descendants. / 候補タスク一覧
 * @returns The root-cause analysis, the impact tree, and flat affected-id list. / 波及ツリー
 */
export function buildFailureImpactTree(
  failedTaskId: number,
  tasks: FailureTaskSnapshot[],
): FailureImpactTreeResult {
  const byId = new Map<number, FailureTaskSnapshot>();
  const childrenByParentId = new Map<number, FailureTaskSnapshot[]>();
  for (const task of tasks) {
    byId.set(task.id, task);
    if (task.parentId != null) {
      const siblings = childrenByParentId.get(task.parentId) ?? [];
      siblings.push(task);
      childrenByParentId.set(task.parentId, siblings);
    }
  }

  const rootSnapshot = byId.get(failedTaskId);
  const warnings: string[] = [];

  if (!rootSnapshot) {
    return {
      rootCause: { category: 'unclassified', detail: 'failed task not found in input data' },
      tree: null,
      affectedTaskIds: [],
      warnings: [`task ${failedTaskId} not found`],
    };
  }

  const affectedTaskIds: number[] = [];

  const buildNode = (
    snapshot: FailureTaskSnapshot,
    relation: FailureImpactNode['relation'],
    depth: number,
    ancestorIds: Set<number>,
  ): FailureImpactNode => {
    const nextAncestorIds = new Set(ancestorIds);
    nextAncestorIds.add(snapshot.id);

    const childSnapshots = childrenByParentId.get(snapshot.id) ?? [];
    const children: FailureImpactNode[] = [];
    for (const child of childSnapshots) {
      if (nextAncestorIds.has(child.id)) {
        warnings.push(`cycle detected at task ${child.id} (parent chain revisits an ancestor)`);
        continue;
      }
      affectedTaskIds.push(child.id);
      children.push(
        buildNode(child, depth === 0 ? 'direct' : 'indirect', depth + 1, nextAncestorIds),
      );
    }

    return {
      taskId: snapshot.id,
      title: snapshot.title,
      status: snapshot.status,
      relation,
      depth,
      children,
    };
  };

  const tree = buildNode(rootSnapshot, 'root', 0, new Set());
  const rootCause = classifyFailureRootCause(rootSnapshot);

  return { rootCause, tree, affectedTaskIds, warnings };
}
