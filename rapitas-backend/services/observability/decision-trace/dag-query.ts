/**
 * decision-trace/dag-query
 *
 * Reconstructs the decision DAG (nodes + edges) for a task or execution from
 * persisted AgentDecisionTrace rows. Defensive against corrupt data: cycles
 * are detected and their edges dropped (never thrown) so the viewing API
 * stays available.
 */
import { prisma } from '../../../config/database';
import { createLogger } from '../../../config/logger';
import type { AgentDecisionTraceRow } from './types';

const log = createLogger('decision-trace');

/** One parent→child dependency edge in the decision DAG. */
export interface DecisionDagEdge {
  /** Parent nodeKey (the decision depended upon). */
  from: string;
  /** Child nodeKey (the dependent decision). */
  to: string;
}

/** Reconstructed decision DAG for one task/execution. */
export interface DecisionDag {
  nodes: AgentDecisionTraceRow[];
  edges: DecisionDagEdge[];
}

/**
 * Parses a persisted parentKeys JSON array, tolerating corrupt values.
 *
 * @param raw - Persisted parentKeys column value / 永続化されたparentKeys
 * @returns Parsed string array, empty on any mismatch / パース結果（不正時は空）
 */
function parseParentKeys(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((k): k is string => typeof k === 'string');
  } catch {
    return [];
  }
}

/**
 * Returns the set of nodeKeys involved in at least one cycle, via iterative
 * DFS with visiting/visited sets (standard back-edge detection).
 *
 * @param adjacency - nodeKey -> child nodeKeys / 隣接リスト
 * @returns nodeKeys on a detected back-edge path / 循環に関与するnodeKey集合
 */
function findCyclicNodes(adjacency: Map<string, string[]>): Set<string> {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const cyclic = new Set<string>();

  const dfs = (start: string): void => {
    // Explicit stack (node + child cursor) instead of recursion — audit DAGs
    // are unbounded and a deep chain must not blow the call stack.
    const stack: Array<{ key: string; nextChild: number }> = [{ key: start, nextChild: 0 }];
    visiting.add(start);
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      const children = adjacency.get(frame.key) ?? [];
      if (frame.nextChild < children.length) {
        const child = children[frame.nextChild];
        frame.nextChild += 1;
        if (visiting.has(child)) {
          // Back edge: everything currently on the visiting path is cyclic.
          for (const f of stack) cyclic.add(f.key);
          cyclic.add(child);
        } else if (!visited.has(child)) {
          visiting.add(child);
          stack.push({ key: child, nextChild: 0 });
        }
      } else {
        visiting.delete(frame.key);
        visited.add(frame.key);
        stack.pop();
      }
    }
  };

  for (const key of adjacency.keys()) {
    if (!visited.has(key)) dfs(key);
  }
  return cyclic;
}

/**
 * Loads the decision DAG for a task or execution.
 *
 * Edges pointing to nodeKeys not present in the result set are dropped
 * silently; edges involved in a cycle are dropped with one warn log (nodes
 * are kept either way). Never throws on corrupt graph data.
 *
 * @param params - taskId and/or executionId filter (at least one required) / 絞り込み条件
 * @returns Nodes and parent→child edges / ノードとエッジ
 * @throws {Error} When neither taskId nor executionId is given. / 両方未指定の場合
 */
export async function getDecisionDag(params: {
  taskId?: number;
  executionId?: number;
}): Promise<DecisionDag> {
  if (params.taskId === undefined && params.executionId === undefined) {
    throw new Error('getDecisionDag requires taskId or executionId');
  }

  const nodes = (await prisma.agentDecisionTrace.findMany({
    where: {
      ...(params.taskId !== undefined ? { taskId: params.taskId } : {}),
      ...(params.executionId !== undefined ? { executionId: params.executionId } : {}),
    },
    orderBy: { id: 'asc' },
  })) as AgentDecisionTraceRow[];

  const knownKeys = new Set(nodes.map((n) => n.nodeKey));
  const adjacency = new Map<string, string[]>();
  for (const key of knownKeys) adjacency.set(key, []);
  const edges: DecisionDagEdge[] = [];
  for (const node of nodes) {
    for (const parent of parseParentKeys(node.parentKeys)) {
      if (!knownKeys.has(parent)) continue;
      edges.push({ from: parent, to: node.nodeKey });
      adjacency.get(parent)!.push(node.nodeKey);
    }
  }

  const cyclic = findCyclicNodes(adjacency);
  if (cyclic.size === 0) return { nodes, edges };

  log.warn(
    { taskId: params.taskId, executionId: params.executionId, nodeKeys: [...cyclic] },
    'decision DAG contains a cycle — dropping its edges, keeping nodes',
  );
  return {
    nodes,
    edges: edges.filter((e) => !(cyclic.has(e.from) && cyclic.has(e.to))),
  };
}
