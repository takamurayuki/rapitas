/**
 * prompt-evolution-tree.test
 *
 * Fixture-driven tests for the pure tree-building, confidence-derivation, and
 * JSON-parsing helpers. No database, no Prisma — see module doc.
 */
import { describe, test, expect, mock } from 'bun:test';

mock.module('../../config/logger', () => {
  const noop = {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
    fatal: () => {},
  };
  return {
    createLogger: () => noop,
    logger: noop,
    getBackendLogFilePath: () => '/tmp/backend.log',
  };
});

const {
  buildPromptEvolutionTree,
  computeTreeConfidence,
  parseApplicableConditions,
  parseFailureCases,
} = await import('./prompt-evolution-tree');
import type { PromptEvolutionTreeRow } from './prompt-evolution-tree';

function row(overrides: Partial<PromptEvolutionTreeRow> & { id: number }): PromptEvolutionTreeRow {
  return {
    parentId: null,
    status: 'completed',
    basePromptKey: 'workflow_role_planner',
    taskType: 'planner',
    performanceDelta: 0,
    significanceLevel: null,
    applicableConditionsJson: null,
    failureCasesJson: null,
    abTested: false,
    abComparisonRef: null,
    createdAt: new Date(2026, 0, overrides.id),
    ...overrides,
  };
}

describe('computeTreeConfidence', () => {
  test('high: A/B tested, low significance, completed', () => {
    expect(
      computeTreeConfidence({ abTested: true, significanceLevel: 'low', status: 'completed' }),
    ).toBe('high');
  });

  test('medium: A/B tested with medium significance', () => {
    expect(
      computeTreeConfidence({ abTested: true, significanceLevel: 'medium', status: 'completed' }),
    ).toBe('medium');
  });

  test('medium: A/B tested but only approved (not yet settled)', () => {
    expect(
      computeTreeConfidence({ abTested: true, significanceLevel: 'low', status: 'approved' }),
    ).toBe('medium');
  });

  test('low: never A/B tested', () => {
    expect(
      computeTreeConfidence({ abTested: false, significanceLevel: 'low', status: 'completed' }),
    ).toBe('low');
  });

  test('low: A/B tested but high uncertainty', () => {
    expect(
      computeTreeConfidence({ abTested: true, significanceLevel: 'high', status: 'completed' }),
    ).toBe('low');
  });

  test('low: reverted despite A/B testing', () => {
    expect(
      computeTreeConfidence({ abTested: true, significanceLevel: 'low', status: 'reverted' }),
    ).toBe('low');
  });
});

describe('parseApplicableConditions', () => {
  test('null input yields the all-null shape', () => {
    expect(parseApplicableConditions(null)).toEqual({
      dayOfWeek: null,
      modelVersion: null,
      userSegment: null,
    });
  });

  test('parses a valid JSON payload', () => {
    expect(
      parseApplicableConditions(
        JSON.stringify({ dayOfWeek: ['mon', 'tue'], modelVersion: ['claude-sonnet-5'] }),
      ),
    ).toEqual({ dayOfWeek: ['mon', 'tue'], modelVersion: ['claude-sonnet-5'], userSegment: null });
  });

  test('malformed JSON falls back to the empty shape rather than throwing', () => {
    expect(parseApplicableConditions('{not json')).toEqual({
      dayOfWeek: null,
      modelVersion: null,
      userSegment: null,
    });
  });
});

describe('parseFailureCases', () => {
  test('null input yields an empty array', () => {
    expect(parseFailureCases(null)).toEqual([]);
  });

  test('parses a valid JSON array', () => {
    const parsed = parseFailureCases(
      JSON.stringify([{ occurredAt: '2026-09-01T00:00:00.000Z', description: 'timeout increase' }]),
    );
    expect(parsed).toEqual([
      {
        occurredAt: '2026-09-01T00:00:00.000Z',
        description: 'timeout increase',
        relatedExecutionId: null,
        failureCause: null,
      },
    ]);
  });

  test('malformed JSON falls back to an empty array', () => {
    expect(parseFailureCases('not an array')).toEqual([]);
  });
});

describe('buildPromptEvolutionTree', () => {
  test('a single root with no children', () => {
    const tree = buildPromptEvolutionTree([row({ id: 1 })]);
    expect(tree).toHaveLength(1);
    expect(tree[0].id).toBe(1);
    expect(tree[0].children).toEqual([]);
  });

  test('multiple independent roots (no shared basePromptKey history)', () => {
    const tree = buildPromptEvolutionTree([row({ id: 1 }), row({ id: 2 })]);
    expect(tree.map((n) => n.id).sort()).toEqual([1, 2]);
    expect(tree.every((n) => n.children.length === 0)).toBe(true);
  });

  test('parent-child linkage via parentId', () => {
    const tree = buildPromptEvolutionTree([row({ id: 1 }), row({ id: 2, parentId: 1 })]);
    expect(tree).toHaveLength(1);
    expect(tree[0].id).toBe(1);
    expect(tree[0].children).toHaveLength(1);
    expect(tree[0].children[0].id).toBe(2);
  });

  test('deep nesting (5+ levels)', () => {
    const rows = [
      row({ id: 1 }),
      row({ id: 2, parentId: 1 }),
      row({ id: 3, parentId: 2 }),
      row({ id: 4, parentId: 3 }),
      row({ id: 5, parentId: 4 }),
      row({ id: 6, parentId: 5 }),
    ];
    const tree = buildPromptEvolutionTree(rows);
    let node = tree[0];
    const chain = [node.id];
    while (node.children.length > 0) {
      node = node.children[0];
      chain.push(node.id);
    }
    expect(chain).toEqual([1, 2, 3, 4, 5, 6]);
  });

  test('a dangling parentId (parent not in the given rows) becomes a root', () => {
    const tree = buildPromptEvolutionTree([row({ id: 2, parentId: 999 })]);
    expect(tree).toHaveLength(1);
    expect(tree[0].id).toBe(2);
  });

  test('a direct cycle (a -> b -> a) forces both members to root, not an infinite loop', () => {
    const tree = buildPromptEvolutionTree([
      row({ id: 1, parentId: 2 }),
      row({ id: 2, parentId: 1 }),
    ]);
    expect(tree.map((n) => n.id).sort()).toEqual([1, 2]);
  });

  test('a self-referencing row (a -> a) becomes a root', () => {
    const tree = buildPromptEvolutionTree([row({ id: 1, parentId: 1 })]);
    expect(tree).toHaveLength(1);
    expect(tree[0].id).toBe(1);
  });

  test('every node carries the 5 required attributes (values may be null/false/empty)', () => {
    const tree = buildPromptEvolutionTree([row({ id: 1 })]);
    const node = tree[0];
    expect(node.taskType).toBeDefined();
    expect(node.performanceDelta).toBeDefined();
    expect(node.significanceLevel).toBeDefined();
    expect(node.applicableConditions).toBeDefined();
    expect(node.failureCases).toBeDefined();
    expect(node.treeConfidence).toBeDefined();
  });
});
