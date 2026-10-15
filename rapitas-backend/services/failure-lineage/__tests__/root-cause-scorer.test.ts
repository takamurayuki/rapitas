/**
 * root-cause-scorer unit tests
 *
 * Single node, branching, threshold exclusion, de-duplicated descendants and
 * the top-3 cap.
 */
import { describe, test, expect } from 'bun:test';
import { scoreRootCauses } from '../root-cause-scorer';
import type { LineageEdge, LineageNode } from '../failure-lineage-types';

function node(id: string, ts: number): LineageNode {
  return {
    id,
    executionId: 1,
    level: 'ERROR',
    template: id,
    templateId: id,
    resources: [],
    timestamp: ts,
    sequenceNumber: ts,
    sample: id,
  };
}
const edge = (p: string, c: string, confidence: number): LineageEdge => ({
  parentId: p,
  childId: c,
  confidence,
  basis: 'rule',
});

describe('scoreRootCauses', () => {
  test('single node and empty input yield no candidates', () => {
    expect(scoreRootCauses([], [])).toEqual([]);
    expect(scoreRootCauses([node('a', 1)], [])).toEqual([]);
  });

  test('chain root gets N = number of descendants', () => {
    const nodes = [node('a', 1), node('b', 2), node('c', 3)];
    const res = scoreRootCauses(nodes, [edge('a', 'b', 0.9), edge('b', 'c', 0.9)]);
    expect(res).toEqual([{ nodeId: 'a', estimatedReducedCount: 2 }]);
  });

  test('branching tree counts each descendant once', () => {
    const nodes = ['a', 'b', 'c', 'd'].map((id, i) => node(id, i + 1));
    const res = scoreRootCauses(nodes, [
      edge('a', 'b', 0.9),
      edge('a', 'c', 0.5),
      edge('c', 'd', 0.5),
    ]);
    expect(res[0]).toEqual({ nodeId: 'a', estimatedReducedCount: 3 });
  });

  test('edges below 0.3 are not counted and make the child a root', () => {
    const nodes = [node('a', 1), node('b', 2), node('c', 3)];
    const res = scoreRootCauses(nodes, [edge('a', 'b', 0.15), edge('b', 'c', 0.9)]);
    expect(res).toEqual([{ nodeId: 'b', estimatedReducedCount: 1 }]);
  });

  test('threshold boundary: confidence 0.3 is counted', () => {
    const res = scoreRootCauses([node('a', 1), node('b', 2)], [edge('a', 'b', 0.3)]);
    expect(res).toEqual([{ nodeId: 'a', estimatedReducedCount: 1 }]);
  });

  test('returns at most 3, ordered by N desc', () => {
    const nodes: LineageNode[] = [];
    const edges: LineageEdge[] = [];
    let ts = 1;
    for (let r = 0; r < 5; r++) {
      nodes.push(node(`r${r}`, ts++));
      for (let k = 0; k <= r; k++) {
        nodes.push(node(`r${r}c${k}`, ts++));
        edges.push(edge(`r${r}`, `r${r}c${k}`, 0.9));
      }
    }
    const res = scoreRootCauses(nodes, edges);
    expect(res.map((c) => c.nodeId)).toEqual(['r4', 'r3', 'r2']);
    expect(res.map((c) => c.estimatedReducedCount)).toEqual([5, 4, 3]);
  });

  test('a cycle in the edge list does not recurse forever', () => {
    const nodes = [node('a', 1), node('b', 2)];
    const res = scoreRootCauses(nodes, [edge('a', 'b', 0.9), edge('b', 'a', 0.9)]);
    expect(res).toEqual([]);
  });
});
