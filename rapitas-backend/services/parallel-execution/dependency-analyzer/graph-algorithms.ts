/**
 * DependencyAnalyzer / GraphAlgorithms
 *
 * Pure graph algorithms operating on TaskNode maps and DependencyEdge arrays:
 * topological sort, critical-path calculation, parallel-group generation,
 * and cycle detection.
 * Not responsible for node initialisation, edge creation, or plan generation.
 */

import type {
  TaskNode,
  DependencyEdge,
  ParallelGroup,
} from '../types';

/**
 * Produce a topological ordering of the node IDs.
 * Nodes whose dependencies appear earlier in the returned array.
 *
 * @param nodes - All task nodes in the graph / グラフ内の全タスクノード
 * @returns Node IDs in topological order / トポロジカル順のノードID配列
 */
export function topologicalSort(nodes: Map<number, TaskNode>): number[] {
  const visited = new Set<number>();
  const result: number[] = [];

  const visit = (nodeId: number) => {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);

    const node = nodes.get(nodeId);
    if (node) {
      for (const depId of node.dependencies) {
        visit(depId);
      }
    }
    result.push(nodeId);
  };

  for (const nodeId of nodes.keys()) {
    visit(nodeId);
  }

  return result;
}

/**
 * Find the longest path through the dependency graph (critical path).
 * Uses the topological order to propagate longest distances forward.
 *
 * @param nodes - All task nodes / 全タスクノード
 * @returns Ordered array of node IDs on the critical path / クリティカルパス上のノードID配列
 */
export function calculateCriticalPath(nodes: Map<number, TaskNode>): number[] {
  const distances = new Map<number, number>();
  const predecessors = new Map<number, number | null>();

  for (const nodeId of nodes.keys()) {
    distances.set(nodeId, -Infinity);
    predecessors.set(nodeId, null);
  }

  const startNodes = Array.from(nodes.values())
    .filter((n) => n.dependencies.length === 0)
    .map((n) => n.id);

  for (const startId of startNodes) {
    distances.set(startId, nodes.get(startId)?.estimatedHours || 0);
  }

  const sorted = topologicalSort(nodes);

  for (const nodeId of sorted) {
    const node = nodes.get(nodeId)!;
    const currentDist = distances.get(nodeId)!;

    for (const dependentId of node.dependents) {
      const dependent = nodes.get(dependentId)!;
      const newDist = currentDist + (dependent.estimatedHours || 0);

      if (newDist > (distances.get(dependentId) || -Infinity)) {
        distances.set(dependentId, newDist);
        predecessors.set(dependentId, nodeId);
      }
    }
  }

  let maxDist = -Infinity;
  let endNode: number | null = null;
  for (const [nodeId, dist] of distances) {
    if (dist > maxDist) {
      maxDist = dist;
      endNode = nodeId;
    }
  }

  const path: number[] = [];
  let current = endNode;
  while (current !== null) {
    path.unshift(current);
    current = predecessors.get(current) || null;
  }

  return path;
}

/**
 * Group tasks by execution depth so that all tasks at the same depth level
 * can potentially run in parallel.
 *
 * @param nodes - All task nodes (with `depth` already computed) / depthが計算済みの全タスクノード
 * @param edges - All dependency edges / 全依存エッジ
 * @returns Ordered array of parallel execution groups / 並列実行グループの配列
 */
export function generateParallelGroups(
  nodes: Map<number, TaskNode>,
  edges: DependencyEdge[],
): ParallelGroup[] {
  const groups: ParallelGroup[] = [];
  const assigned = new Set<number>();

  const maxDepth = calculateMaxDepth(nodes);

  for (let level = 0; level <= maxDepth; level++) {
    const levelTasks: number[] = [];

    for (const node of nodes.values()) {
      if (node.depth === level && !assigned.has(node.id)) {
        const canSchedule = node.dependencies.every((depId) => {
          const depNode = nodes.get(depId);
          return depNode && depNode.depth < level;
        });

        if (canSchedule) {
          levelTasks.push(node.id);
          assigned.add(node.id);
        }
      }
    }

    if (levelTasks.length > 0) {
      const internalDeps = edges.filter(
        (e) => levelTasks.includes(e.fromTaskId) && levelTasks.includes(e.toTaskId),
      );

      const dependsOnGroups: number[] = [];
      for (const taskId of levelTasks) {
        const node = nodes.get(taskId)!;
        for (const depId of node.dependencies) {
          const depGroup = groups.find((g) => g.taskIds.includes(depId));
          if (depGroup && !dependsOnGroups.includes(depGroup.groupId)) {
            dependsOnGroups.push(depGroup.groupId);
          }
        }
      }

      const estimatedDuration = Math.max(
        ...levelTasks.map((id) => nodes.get(id)?.estimatedHours || 1),
      );

      groups.push({
        groupId: groups.length,
        level,
        taskIds: levelTasks,
        canRunParallel: internalDeps.every((e) => e.weight < 70),
        estimatedDuration,
        internalDependencies: internalDeps,
        dependsOnGroups,
      });
    }
  }

  return groups;
}

/**
 * Detect whether the dependency graph contains a cycle using DFS.
 *
 * @param nodes - All task nodes / 全タスクノード
 * @returns True if at least one cycle was detected / 循環が検出された場合はtrue
 */
export function detectCycles(nodes: Map<number, TaskNode>): boolean {
  const visited = new Set<number>();
  const recStack = new Set<number>();

  const dfs = (nodeId: number): boolean => {
    visited.add(nodeId);
    recStack.add(nodeId);

    const node = nodes.get(nodeId);
    if (node) {
      for (const depId of node.dependents) {
        if (!visited.has(depId)) {
          if (dfs(depId)) return true;
        } else if (recStack.has(depId)) {
          return true;
        }
      }
    }

    recStack.delete(nodeId);
    return false;
  };

  for (const nodeId of nodes.keys()) {
    if (!visited.has(nodeId)) {
      if (dfs(nodeId)) return true;
    }
  }

  return false;
}

/**
 * Return the maximum `depth` value across all nodes.
 *
 * @param nodes - All task nodes / 全タスクノード
 * @returns Maximum depth / 最大深度
 */
export function calculateMaxDepth(nodes: Map<number, TaskNode>): number {
  let maxDepth = 0;
  for (const node of nodes.values()) {
    maxDepth = Math.max(maxDepth, node.depth);
  }
  return maxDepth;
}
