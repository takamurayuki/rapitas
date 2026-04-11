/**
 * DependencyAnalyzer / PlanBuilder
 *
 * Converts a fully-analysed DependencyTreeMap into a concrete
 * ParallelExecutionPlan and detects per-file resource constraints.
 * Not responsible for node initialisation, edge calculation, or graph
 * algorithms.
 */

import type {
  TaskNode,
  DependencyTreeMap,
  ParallelExecutionPlan,
  ResourceConstraint,
} from '../types-dir/types';

import { getFileName } from './utils';

/**
 * Build a concrete parallel execution plan from the dependency tree map.
 *
 * @param parentTaskId - ID of the parent task that owns this plan / 親タスクID
 * @param treeMap - Fully-analysed dependency tree map / 分析済み依存ツリーマップ
 * @param nodes - All task nodes (used for sequential duration calculation) / 全タスクノード
 * @param config - Optional execution configuration / 実行設定（省略可）
 * @returns Concrete parallel execution plan / 並列実行プラン
 */
export function buildExecutionPlan(
  parentTaskId: number,
  treeMap: DependencyTreeMap,
  nodes: Map<number, TaskNode>,
  config?: Partial<{ maxConcurrentAgents: number }>,
): ParallelExecutionPlan {
  const maxConcurrency = config?.maxConcurrentAgents || 3;

  const executionOrder: number[][] = [];
  for (const group of treeMap.parallelGroups) {
    const tasks = [...group.taskIds];
    while (tasks.length > 0) {
      const batch = tasks.splice(0, maxConcurrency);
      executionOrder.push(batch);
    }
  }

  const resourceConstraints = detectResourceConstraints(nodes);

  let estimatedTotalDuration = 0;
  for (const group of treeMap.parallelGroups) {
    estimatedTotalDuration += group.estimatedDuration;
  }

  const estimatedSequentialDuration = Array.from(nodes.values()).reduce(
    (sum, n) => sum + (n.estimatedHours || 0),
    0,
  );

  const parallelEfficiency =
    estimatedSequentialDuration > 0
      ? Math.round((1 - estimatedTotalDuration / estimatedSequentialDuration) * 100)
      : 0;

  return {
    id: `plan-${parentTaskId}-${Date.now()}`,
    parentTaskId,
    createdAt: new Date(),
    groups: treeMap.parallelGroups,
    executionOrder,
    estimatedTotalDuration,
    estimatedSequentialDuration,
    parallelEfficiency: Math.max(0, parallelEfficiency),
    maxConcurrency,
    resourceConstraints,
  };
}

/**
 * Identify files used by multiple tasks and build concurrency constraints.
 * Index, schema, config and package.json files are limited to one concurrent
 * writer to prevent merge conflicts.
 *
 * @param nodes - All task nodes / 全タスクノード
 * @returns Array of resource constraints / リソース制約の配列
 */
export function detectResourceConstraints(nodes: Map<number, TaskNode>): ResourceConstraint[] {
  const constraints: ResourceConstraint[] = [];
  const fileUsage = new Map<string, number[]>();

  for (const node of nodes.values()) {
    for (const file of node.files) {
      const fileName = getFileName(file);
      if (!fileUsage.has(fileName)) {
        fileUsage.set(fileName, []);
      }
      fileUsage.get(fileName)!.push(node.id);
    }
  }

  for (const [fileName, taskIds] of fileUsage) {
    if (taskIds.length > 1) {
      // NOTE: index/schema/config/package.json are serialised to 1 concurrent writer
      // to prevent merge conflicts in high-impact shared files
      const isImportantFile = fileName.match(/index\.|schema\.|config\.|package\.json/);
      constraints.push({
        type: 'file',
        resource: fileName,
        maxConcurrent: isImportantFile ? 1 : 2,
        affectedTasks: taskIds,
      });
    }
  }

  return constraints;
}
