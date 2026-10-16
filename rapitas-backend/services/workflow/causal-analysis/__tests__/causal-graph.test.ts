/**
 * causal-graph tests
 *
 * Covers dependency-edge construction and transitive downstream traversal.
 */
import { describe, it, expect } from 'bun:test';
import { buildDependencyGraph, collectDownstream } from '../causal-graph';

describe('buildDependencyGraph', () => {
  it('maps dependency -> dependent edges', () => {
    const g = buildDependencyGraph([
      { taskId: 2, dependencies: '[1]' },
      { taskId: 3, dependencies: '[1,2]' },
    ]);
    expect([...(g.get(1) ?? [])].sort()).toEqual([2, 3]);
    expect([...(g.get(2) ?? [])]).toEqual([3]);
  });

  it('treats invalid / non-array JSON as no edges without throwing', () => {
    const g = buildDependencyGraph([
      { taskId: 2, dependencies: 'not json' },
      { taskId: 3, dependencies: '{"a":1}' },
      { taskId: 4, dependencies: null },
      { taskId: 5, dependencies: '["x",7.5,6]' },
    ]);
    expect([...g.keys()]).toEqual([6]);
  });
});

describe('collectDownstream', () => {
  it('returns the transitive downstream set', () => {
    const g = buildDependencyGraph([
      { taskId: 2, dependencies: '[1]' },
      { taskId: 3, dependencies: '[2]' },
      { taskId: 4, dependencies: '[3]' },
    ]);
    expect([...collectDownstream(g, 1)].sort()).toEqual([2, 3, 4]);
  });

  it('terminates on cyclic dependencies and excludes the root', () => {
    const g = buildDependencyGraph([
      { taskId: 1, dependencies: '[2]' },
      { taskId: 2, dependencies: '[1]' },
    ]);
    expect([...collectDownstream(g, 1)]).toEqual([2]);
  });

  it('returns empty for an unknown root', () => {
    expect(collectDownstream(new Map(), 9).size).toBe(0);
  });
});
