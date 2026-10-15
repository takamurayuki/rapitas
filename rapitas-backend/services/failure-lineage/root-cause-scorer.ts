/**
 * root-cause-scorer
 *
 * Picks root-cause candidates from an estimated lineage and estimates how
 * many downstream events a fix would remove. The count is a counterfactual
 * estimate, not a measurement.
 */
import type { LineageEdge, LineageNode, RootCauseCandidate } from './failure-lineage-types';
import { MIN_COUNTED_CONFIDENCE } from './lineage-builder';

/** Number of candidates returned. */
export const MAX_CANDIDATES = 3;

/** Counts distinct descendants (start node excluded) via a visited set. */
function countDescendants(nodeId: string, children: Map<string, string[]>): number {
  const seen = new Set<string>([nodeId]);
  const stack = [nodeId];
  while (stack.length > 0) {
    const cur = stack.pop() as string;
    for (const c of children.get(cur) ?? []) {
      if (seen.has(c)) continue;
      seen.add(c);
      stack.push(c);
    }
  }
  return seen.size - 1;
}

/**
 * Selects top root-cause candidates: nodes with no parent edge of confidence
 * >= 0.3, ranked by the number of descendants reachable through such edges.
 *
 * @param nodes - Lineage nodes in time order / 時系列ノード
 * @param edges - Estimated edges / 推定エッジ
 * @returns Up to 3 candidates with N >= 1, largest N first / 候補
 */
export function scoreRootCauses(
  nodes: readonly LineageNode[],
  edges: readonly LineageEdge[],
): RootCauseCandidate[] {
  const children = new Map<string, string[]>();
  const hasStrongParent = new Set<string>();
  for (const e of edges) {
    if (e.confidence < MIN_COUNTED_CONFIDENCE) continue;
    hasStrongParent.add(e.childId);
    const list = children.get(e.parentId) ?? [];
    list.push(e.childId);
    children.set(e.parentId, list);
  }
  const order = new Map(nodes.map((n, i) => [n.id, i]));
  return nodes
    .filter((n) => !hasStrongParent.has(n.id))
    .map((n) => ({ nodeId: n.id, estimatedReducedCount: countDescendants(n.id, children) }))
    .filter((c) => c.estimatedReducedCount >= 1)
    .sort(
      (a, b) =>
        b.estimatedReducedCount - a.estimatedReducedCount ||
        (order.get(a.nodeId) ?? 0) - (order.get(b.nodeId) ?? 0),
    )
    .slice(0, MAX_CANDIDATES);
}
