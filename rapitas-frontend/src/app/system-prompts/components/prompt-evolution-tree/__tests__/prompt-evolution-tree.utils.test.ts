import { describe, it, expect } from 'vitest';
import {
  countPopulatedAttributes,
  flattenTree,
  formatPerformanceDelta,
  TREE_CONFIDENCE_BADGE_CLASS,
} from '../prompt-evolution-tree.utils';
import type { PromptEvolutionTreeNode } from '../prompt-evolution-tree.types';

function node(
  overrides: Partial<PromptEvolutionTreeNode> & { id: number },
): PromptEvolutionTreeNode {
  return {
    parentId: null,
    status: 'completed',
    basePromptKey: 'workflow_role_planner',
    taskType: 'planner',
    performanceDelta: 0,
    significanceLevel: null,
    applicableConditions: { dayOfWeek: null, modelVersion: null, userSegment: null },
    failureCases: [],
    abTested: false,
    abComparisonRef: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    treeConfidence: 'low',
    children: [],
    ...overrides,
  };
}

describe('flattenTree', () => {
  it('returns an empty list for an empty forest', () => {
    expect(flattenTree([])).toEqual([]);
  });

  it('flattens a single root with no children at depth 0', () => {
    const rows = flattenTree([node({ id: 1 })]);
    expect(rows).toEqual([{ node: expect.objectContaining({ id: 1 }), depth: 0 }]);
  });

  it('flattens nested children depth-first, pre-order', () => {
    const child2 = node({ id: 3 });
    const child1 = node({ id: 2, children: [child2] });
    const root = node({ id: 1, children: [child1] });
    const rows = flattenTree([root]);
    expect(rows.map((r) => [r.node.id, r.depth])).toEqual([
      [1, 0],
      [2, 1],
      [3, 2],
    ]);
  });

  it('flattens multiple independent roots in order', () => {
    const rows = flattenTree([node({ id: 1 }), node({ id: 2 })]);
    expect(rows.map((r) => r.node.id)).toEqual([1, 2]);
    expect(rows.every((r) => r.depth === 0)).toBe(true);
  });
});

describe('TREE_CONFIDENCE_BADGE_CLASS', () => {
  it('has an entry for every confidence level', () => {
    expect(Object.keys(TREE_CONFIDENCE_BADGE_CLASS).sort()).toEqual(['high', 'low', 'medium']);
  });
});

describe('formatPerformanceDelta', () => {
  it('formats a positive delta with a leading plus sign', () => {
    expect(formatPerformanceDelta(0.032)).toBe('+3.2pt');
  });

  it('formats a negative delta without a double sign', () => {
    expect(formatPerformanceDelta(-0.01)).toBe('-1.0pt');
  });

  it('formats zero without a sign', () => {
    expect(formatPerformanceDelta(0)).toBe('0.0pt');
  });
});

describe('countPopulatedAttributes', () => {
  it('counts 0 when every attribute is empty/null/false', () => {
    expect(countPopulatedAttributes(node({ id: 1, taskType: null }))).toBe(0);
  });

  it('counts every populated attribute', () => {
    const n = node({
      id: 1,
      taskType: 'planner',
      significanceLevel: 'low',
      abComparisonRef: '1',
      applicableConditions: { dayOfWeek: ['mon'], modelVersion: null, userSegment: null },
      failureCases: [
        {
          occurredAt: '2026-01-01T00:00:00.000Z',
          description: 'x',
          relatedExecutionId: null,
          failureCause: null,
        },
      ],
    });
    expect(countPopulatedAttributes(n)).toBe(5);
  });
});
