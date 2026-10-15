/**
 * failure-lineage.utils tests
 *
 * Confidence formatting and tree flattening: order, depth, candidate
 * annotation, orphan edges and cycle safety.
 */
import { describe, it, expect } from 'vitest';
import { flattenLineage, formatConfidence } from '../failure-lineage.utils';
import type { FailureLineageData, LineageNode } from '../types';

const node = (n: number): LineageNode => ({
  id: `log-${n}`,
  executionId: 1,
  level: 'ERROR',
  template: `t${n}`,
  templateId: `t${n}`,
  resources: [],
  timestamp: n,
  sequenceNumber: n,
  sample: '',
});

function data(partial: Partial<FailureLineageData>): FailureLineageData {
  return {
    nodes: [],
    edges: [],
    clusters: [],
    rootCauseCandidates: [],
    validation: {
      matchRate: null,
      knownEdgeCount: 0,
      matched: 0,
      mismatched: 0,
      unchecked: 0,
      liveConfirmed: 0,
      decisionLogMatches: 0,
      chains: [],
    },
    truncated: false,
    isEstimated: true,
    windowHours: 24,
    ...partial,
  };
}

describe('formatConfidence', () => {
  it('always prints two decimals', () => {
    expect(formatConfidence(0.9)).toBe('0.90');
    expect(formatConfidence(0.15)).toBe('0.15');
    expect(formatConfidence(1)).toBe('1.00');
  });
});

describe('flattenLineage', () => {
  it('orders depth-first with depth, parent edge and candidate count', () => {
    const rows = flattenLineage(
      data({
        nodes: [node(1), node(2), node(3), node(4)],
        edges: [
          { parentId: 'log-1', childId: 'log-2', confidence: 0.9, basis: 'rule' },
          { parentId: 'log-2', childId: 'log-3', confidence: 0.5, basis: 'same_execution' },
        ],
        rootCauseCandidates: [{ nodeId: 'log-1', estimatedReducedCount: 2 }],
      }),
    );
    expect(rows.map((r) => [r.node.id, r.depth])).toEqual([
      ['log-1', 0],
      ['log-2', 1],
      ['log-3', 2],
      ['log-4', 0],
    ]);
    expect(rows[0].reducedCount).toBe(2);
    expect(rows[1].parentEdge?.confidence).toBe(0.9);
    expect(rows[3].parentEdge).toBeNull();
  });

  it('returns no rows for empty data and ignores edges to unknown nodes', () => {
    expect(flattenLineage(data({}))).toEqual([]);
    const rows = flattenLineage(
      data({
        nodes: [node(1)],
        edges: [{ parentId: 'log-9', childId: 'log-1', confidence: 0.9, basis: 'rule' }],
      }),
    );
    expect(rows).toHaveLength(1);
  });

  it('terminates on a cycle in the edge list', () => {
    const rows = flattenLineage(
      data({
        nodes: [node(1), node(2)],
        edges: [
          { parentId: 'log-1', childId: 'log-2', confidence: 0.9, basis: 'rule' },
          { parentId: 'log-2', childId: 'log-1', confidence: 0.9, basis: 'rule' },
        ],
      }),
    );
    expect(rows.length).toBeLessThanOrEqual(2);
  });
});
