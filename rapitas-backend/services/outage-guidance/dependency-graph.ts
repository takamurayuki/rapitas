/**
 * dependency-graph
 *
 * Pure reverse-reachability over a team's service dependency graph: which
 * services are transitively impacted when one service stops, and the shortest
 * dependency path that proves each impact. Does not classify risk (see
 * outage-classifier.ts).
 */
import type { AffectedService, OutageInventory } from './outage-guidance.types';

/** Reverse adjacency: service id → ids of services that depend on it (sorted). */
export type ReverseAdjacency = Map<string, string[]>;

// Graphs are immutable once validated, so the adjacency is memoized per
// inventory object to keep repeated real-time assessments allocation-free.
const adjacencyCache = new WeakMap<OutageInventory, ReverseAdjacency>();

/**
 * Builds (or returns the memoized) reverse adjacency list for an inventory.
 *
 * @param inventory - Validated inventory / 検証済みインベントリ
 * @returns Map from a service to its sorted direct dependents / サービス→直接依存元の昇順リスト
 */
export function buildReverseAdjacency(inventory: OutageInventory): ReverseAdjacency {
  const cached = adjacencyCache.get(inventory);
  if (cached) return cached;
  const adjacency: ReverseAdjacency = new Map();
  for (const s of inventory.services) adjacency.set(s.id, []);
  for (const d of inventory.dependencies) {
    const dependents = adjacency.get(d.to);
    // Parallel edges of different kinds (api_call + cache_read to the same
    // target) collapse into one dependent.
    if (dependents && !dependents.includes(d.from)) dependents.push(d.from);
  }
  for (const list of adjacency.values()) list.sort();
  adjacencyCache.set(inventory, adjacency);
  return adjacency;
}

/**
 * Computes every service impacted by stopping `targetId`, with its hop depth
 * and the shortest evidence path `[affected, …, target]`. BFS with a visited
 * set, so cycles terminate. Output is ordered by depth, then service id.
 *
 * @param inventory - Validated inventory / 検証済みインベントリ
 * @param targetId - Service being stopped / 停止対象のサービスID
 * @returns Impacted services (target excluded) / 影響を受けるサービス一覧（対象自身は除く）
 */
export function computeImpact(inventory: OutageInventory, targetId: string): AffectedService[] {
  const adjacency = buildReverseAdjacency(inventory);
  const parent = new Map<string, string>();
  const depth = new Map<string, number>([[targetId, 0]]);
  const order: string[] = [];
  const queue: string[] = [targetId];

  for (let head = 0; head < queue.length; head++) {
    const node = queue[head];
    const nextDepth = (depth.get(node) ?? 0) + 1;
    for (const dependent of adjacency.get(node) ?? []) {
      if (depth.has(dependent)) continue;
      depth.set(dependent, nextDepth);
      parent.set(dependent, node);
      order.push(dependent);
      queue.push(dependent);
    }
  }

  const affected = order.map((serviceId): AffectedService => {
    const path = [serviceId];
    let cursor = serviceId;
    while (cursor !== targetId) {
      cursor = parent.get(cursor) as string;
      path.push(cursor);
    }
    return { serviceId, depth: depth.get(serviceId) as number, path };
  });
  affected.sort((a, b) =>
    a.depth !== b.depth ? a.depth - b.depth : a.serviceId < b.serviceId ? -1 : 1,
  );
  return affected;
}
