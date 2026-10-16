/**
 * lineage-builder
 *
 * Turns raw log rows into normalized ERROR/WARN events and estimates one
 * parent per event ("temporal proximity + shared attributes"). Every edge is
 * an inference carrying a fixed confidence; it is never presented as fact.
 */
import type {
  EdgeBasis,
  LineageEdge,
  LineageNode,
  RawLogRow,
  TemplateCluster,
} from './failure-lineage-types';
import {
  detectLevel,
  extractResources,
  MAX_LINE_LENGTH,
  normalizeTemplate,
  templateIdOf,
} from './log-template-normalizer';
import { matchRule } from './lineage-rules';

/** Parent must precede the child by at most this long. */
export const PARENT_WINDOW_MS = 10 * 60 * 1000;

/** Edges below this confidence are excluded from descendant counting. */
export const MIN_COUNTED_CONFIDENCE = 0.3;

/** Fixed confidence per evidence class, strongest first. */
export const CONFIDENCE_BY_BASIS: Readonly<Record<EdgeBasis, number>> = {
  rule: 0.9,
  same_execution: 0.5,
  same_resource: 0.3,
  time_proximity: 0.15,
};

/**
 * Converts log rows into ERROR/WARN nodes; other rows are dropped.
 *
 * @param rows - Raw rows / 生ログ行
 * @returns Nodes sorted by (timestamp, sequenceNumber, id) / 時系列ノード
 */
export function buildNodes(rows: readonly RawLogRow[]): LineageNode[] {
  const nodes: LineageNode[] = [];
  for (const row of rows) {
    const text = row.logChunk.slice(0, MAX_LINE_LENGTH);
    const level = detectLevel(row.logType, text);
    if (!level) continue;
    const template = normalizeTemplate(text);
    nodes.push({
      id: `log-${row.id}`,
      executionId: row.executionId,
      level,
      template,
      templateId: templateIdOf(template),
      resources: extractResources(text),
      timestamp: row.timestamp instanceof Date ? row.timestamp.getTime() : row.timestamp,
      sequenceNumber: row.sequenceNumber,
      sample: text,
    });
  }
  return nodes.sort(
    (a, b) =>
      a.timestamp - b.timestamp ||
      a.sequenceNumber - b.sequenceNumber ||
      a.id.localeCompare(b.id, 'en', { numeric: true }),
  );
}

function classify(parent: LineageNode, child: LineageNode): { basis: EdgeBasis; ruleId?: string } {
  const rule = matchRule(parent.template, child.template);
  if (rule) return { basis: 'rule', ruleId: rule.id };
  if (parent.executionId === child.executionId) return { basis: 'same_execution' };
  if (parent.resources.some((r) => child.resources.includes(r))) return { basis: 'same_resource' };
  return { basis: 'time_proximity' };
}

/**
 * Estimates at most one parent per node.
 *
 * Same-timestamp pairs are never linked (guards against cycles and arbitrary
 * ordering); among candidates the highest confidence wins, ties go to the
 * most recent candidate.
 *
 * @param sortedNodes - Output of buildNodes / ソート済みノード
 * @returns Estimated edges / 推定エッジ
 */
export function buildEdges(sortedNodes: readonly LineageNode[]): LineageEdge[] {
  const edges: LineageEdge[] = [];
  let windowStart = 0;
  for (let i = 0; i < sortedNodes.length; i++) {
    const child = sortedNodes[i];
    while (
      windowStart < i &&
      child.timestamp - sortedNodes[windowStart].timestamp > PARENT_WINDOW_MS
    ) {
      windowStart++;
    }
    let best: LineageEdge | null = null;
    for (let j = i - 1; j >= windowStart; j--) {
      const parent = sortedNodes[j];
      if (parent.timestamp >= child.timestamp) continue;
      const { basis, ruleId } = classify(parent, child);
      const confidence = CONFIDENCE_BY_BASIS[basis];
      // Scanning newest-first, so strict > keeps the newer candidate on ties.
      if (!best || confidence > best.confidence) {
        best = { parentId: parent.id, childId: child.id, confidence, basis, ruleId };
      }
    }
    if (best) edges.push(best);
  }
  return edges;
}

/**
 * Groups nodes by template.
 *
 * @param nodes - Nodes / ノード
 * @returns Clusters, most frequent first / クラスタ一覧
 */
export function buildClusters(nodes: readonly LineageNode[]): TemplateCluster[] {
  const map = new Map<string, TemplateCluster>();
  for (const n of nodes) {
    const c = map.get(n.templateId);
    if (c) c.count++;
    else {
      map.set(n.templateId, {
        templateId: n.templateId,
        template: n.template,
        level: n.level,
        count: 1,
      });
    }
  }
  return [...map.values()].sort(
    (a, b) => b.count - a.count || a.templateId.localeCompare(b.templateId),
  );
}
