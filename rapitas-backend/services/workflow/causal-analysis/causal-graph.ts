/**
 * causal-graph
 *
 * Builds the task dependency graph from WorkflowQueueItem rows and walks it downstream.
 * Not responsible for deciding which task is a root cause (see root-cause-detector).
 */

/** Minimal queue-item shape needed to derive dependency edges. */
export interface DependencyItem {
  taskId: number;
  /** JSON array of taskIds this item depends on; may be malformed. */
  dependencies: string | null;
}

/** Edge map: dependency taskId -> taskIds that depend on it. */
export type DependencyGraph = Map<number, Set<number>>;

/**
 * Builds a `dependency -> dependents` edge map. Malformed JSON yields no edges
 * for that item (one bad row must not stop the whole analysis).
 *
 * @param items - Queue items with their raw dependency JSON. / 依存JSON付きキューアイテム
 * @returns Edge map keyed by the depended-on task. / 依存先をキーとする辺マップ
 */
export function buildDependencyGraph(items: DependencyItem[]): DependencyGraph {
  const graph: DependencyGraph = new Map();
  for (const item of items) {
    let deps: unknown;
    try {
      deps = JSON.parse(item.dependencies ?? '[]');
    } catch {
      continue; // malformed dependency JSON: treat as no edges
    }
    if (!Array.isArray(deps)) continue;
    for (const dep of deps) {
      if (!Number.isInteger(dep)) continue;
      const set = graph.get(dep as number) ?? new Set<number>();
      set.add(item.taskId);
      graph.set(dep as number, set);
    }
  }
  return graph;
}

/**
 * Collects every task transitively depending on `rootTaskId` (root excluded).
 *
 * @param graph - Edge map from buildDependencyGraph. / 依存グラフ
 * @param rootTaskId - Task to start from. / 起点タスク
 * @returns Transitive downstream taskIds. / 推移的な下流タスクID
 */
export function collectDownstream(graph: DependencyGraph, rootTaskId: number): Set<number> {
  const visited = new Set<number>([rootTaskId]); // visited set bounds traversal on cycles
  const stack = [rootTaskId];
  while (stack.length > 0) {
    const current = stack.pop() as number;
    for (const next of graph.get(current) ?? []) {
      if (visited.has(next)) continue;
      visited.add(next);
      stack.push(next);
    }
  }
  visited.delete(rootTaskId);
  return visited;
}
