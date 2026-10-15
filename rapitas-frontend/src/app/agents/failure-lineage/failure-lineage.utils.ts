/**
 * failure-lineage.utils
 *
 * Pure helpers for the failure-lineage page: confidence formatting and
 * flattening the parent/child edge list into a depth-annotated tree list.
 */
import type { FailureLineageData, LineageEdge, LineageRow } from './types';

/** Window options offered by the page (backend accepts 1-168). */
export const HOURS_OPTIONS = [6, 24, 72, 168] as const;
export const DEFAULT_HOURS = 24;

/**
 * Formats a confidence as a fixed two-decimal string.
 *
 * @param confidence - 0..1 / 確信度
 * @returns e.g. `0.90` / 表示文字列
 */
export function formatConfidence(confidence: number): string {
  return confidence.toFixed(2);
}

/**
 * Flattens the lineage into rows in depth-first order (iterative, so very
 * long chains cannot overflow the call stack).
 *
 * @param data - API payload / 系譜図データ
 * @returns Rows, roots in time order, children under their parent / 行リスト
 */
export function flattenLineage(data: FailureLineageData): LineageRow[] {
  const byId = new Map(data.nodes.map((n) => [n.id, n]));
  const parentEdge = new Map<string, LineageEdge>();
  const children = new Map<string, LineageEdge[]>();
  for (const e of data.edges) {
    if (!byId.has(e.parentId) || !byId.has(e.childId)) continue;
    parentEdge.set(e.childId, e);
    const list = children.get(e.parentId) ?? [];
    list.push(e);
    children.set(e.parentId, list);
  }
  const reduced = new Map(data.rootCauseCandidates.map((c) => [c.nodeId, c.estimatedReducedCount]));

  const rows: LineageRow[] = [];
  const visited = new Set<string>();
  const roots = data.nodes.filter((n) => !parentEdge.has(n.id));
  // Reverse so popping from the stack yields time order.
  const stack: { id: string; depth: number }[] = [...roots]
    .reverse()
    .map((n) => ({ id: n.id, depth: 0 }));
  while (stack.length > 0) {
    const { id, depth } = stack.pop() as { id: string; depth: number };
    if (visited.has(id)) continue;
    visited.add(id);
    const node = byId.get(id);
    if (!node) continue;
    rows.push({
      node,
      depth,
      parentEdge: parentEdge.get(id) ?? null,
      reducedCount: reduced.get(id) ?? null,
    });
    const kids = children.get(id) ?? [];
    for (let i = kids.length - 1; i >= 0; i--) {
      stack.push({ id: kids[i].childId, depth: depth + 1 });
    }
  }
  return rows;
}
