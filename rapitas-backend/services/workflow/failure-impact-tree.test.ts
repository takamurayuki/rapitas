/**
 * failure-impact-tree.test
 *
 * Covers the acceptance-criteria cases explicitly: a cyclic parentId chain,
 * missing/incomplete task data, and a single isolated node — plus a normal
 * multi-level tree and the root-cause classification mapping. No DB, no
 * mocks — every input is a plain snapshot.
 */
import { describe, it, expect } from 'bun:test';
import {
  buildFailureImpactTree,
  classifyFailureRootCause,
  type FailureTaskSnapshot,
} from './failure-impact-tree';

function snapshot(overrides: Partial<FailureTaskSnapshot> & { id: number }): FailureTaskSnapshot {
  return {
    id: overrides.id,
    title: overrides.title ?? `task-${overrides.id}`,
    status: overrides.status ?? 'todo',
    parentId: overrides.parentId ?? null,
    haltReason: overrides.haltReason ?? null,
    lastErrorMessage: overrides.lastErrorMessage ?? null,
  };
}

describe('buildFailureImpactTree', () => {
  it('builds a multi-level tree of direct and indirect dependents', () => {
    const tasks: FailureTaskSnapshot[] = [
      snapshot({ id: 1000, status: 'failed', haltReason: 'budget_cost_exceeded' }),
      snapshot({ id: 1001, parentId: 1000, status: 'todo' }),
      snapshot({ id: 1002, parentId: 1000, status: 'todo' }),
      snapshot({ id: 1010, parentId: 1001, status: 'todo' }),
    ];

    const result = buildFailureImpactTree(1000, tasks);

    expect(result.warnings).toEqual([]);
    expect(result.tree).not.toBeNull();
    expect(result.tree?.taskId).toBe(1000);
    expect(result.tree?.relation).toBe('root');
    expect(result.tree?.children.map((c) => c.taskId).sort()).toEqual([1001, 1002]);
    const child1001 = result.tree?.children.find((c) => c.taskId === 1001);
    expect(child1001?.relation).toBe('direct');
    expect(child1001?.children[0]?.taskId).toBe(1010);
    expect(child1001?.children[0]?.relation).toBe('indirect');
    expect(result.affectedTaskIds.sort()).toEqual([1001, 1002, 1010]);
  });

  it('handles a single isolated node with no subtasks', () => {
    const tasks: FailureTaskSnapshot[] = [snapshot({ id: 2000, status: 'failed' })];

    const result = buildFailureImpactTree(2000, tasks);

    expect(result.tree).toEqual({
      taskId: 2000,
      title: 'task-2000',
      status: 'failed',
      relation: 'root',
      depth: 0,
      children: [],
    });
    expect(result.affectedTaskIds).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('returns a null tree and a warning when the failed task id is missing from the data', () => {
    const tasks: FailureTaskSnapshot[] = [snapshot({ id: 3001, parentId: 3000 })];

    const result = buildFailureImpactTree(3000, tasks);

    expect(result.tree).toBeNull();
    expect(result.affectedTaskIds).toEqual([]);
    expect(result.warnings).toEqual(['task 3000 not found']);
    expect(result.rootCause).toEqual({
      category: 'unclassified',
      detail: 'failed task not found in input data',
    });
  });

  it('cuts a circular parentId chain instead of recursing forever, and records a warning', () => {
    // 4000 -> child 4001 -> child 4002 -> "child" 4000 (cycle back to root).
    const tasks: FailureTaskSnapshot[] = [
      snapshot({ id: 4000, status: 'failed', parentId: 4002 }),
      snapshot({ id: 4001, parentId: 4000 }),
      snapshot({ id: 4002, parentId: 4001 }),
    ];

    const result = buildFailureImpactTree(4000, tasks);

    expect(result.tree).not.toBeNull();
    expect(result.tree?.taskId).toBe(4000);
    expect(result.tree?.children.map((c) => c.taskId)).toEqual([4001]);
    expect(result.tree?.children[0]?.children.map((c) => c.taskId)).toEqual([4002]);
    // The 4002 -> 4000 edge is a cycle back to an ancestor, so it is cut.
    expect(result.tree?.children[0]?.children[0]?.children).toEqual([]);
    expect(result.warnings).toEqual([
      'cycle detected at task 4000 (parent chain revisits an ancestor)',
    ]);
    expect(result.affectedTaskIds.sort()).toEqual([4001, 4002]);
  });

  it('ignores a self-referencing parentId as a one-node cycle', () => {
    const tasks: FailureTaskSnapshot[] = [snapshot({ id: 5000, status: 'failed', parentId: 5000 })];

    const result = buildFailureImpactTree(5000, tasks);

    expect(result.tree?.children).toEqual([]);
    expect(result.warnings).toEqual([
      'cycle detected at task 5000 (parent chain revisits an ancestor)',
    ]);
  });
});

describe('classifyFailureRootCause', () => {
  it('classifies budget_cost_exceeded as resource_exhaustion', () => {
    expect(
      classifyFailureRootCause({ haltReason: 'budget_cost_exceeded', lastErrorMessage: null }),
    ).toEqual({
      category: 'resource_exhaustion',
      detail: 'haltReason=budget_cost_exceeded',
    });
  });

  it('classifies budget_time_exceeded as timeout', () => {
    expect(
      classifyFailureRootCause({ haltReason: 'budget_time_exceeded', lastErrorMessage: null }),
    ).toEqual({
      category: 'timeout',
      detail: 'haltReason=budget_time_exceeded',
    });
  });

  it('falls back to the agent error classifier for a quota error message', () => {
    const result = classifyFailureRootCause({
      haltReason: null,
      lastErrorMessage: 'ERROR: rate limit exceeded, try again at 1:19 PM',
    });
    expect(result.category).toBe('resource_exhaustion');
  });

  it('returns unclassified when neither haltReason nor errorMessage yield a match', () => {
    expect(classifyFailureRootCause({ haltReason: null, lastErrorMessage: null })).toEqual({
      category: 'unclassified',
      detail: 'no haltReason or error message available',
    });
  });

  it('returns unclassified for an unmapped haltReason with no error message', () => {
    expect(classifyFailureRootCause({ haltReason: 'no_progress', lastErrorMessage: null })).toEqual(
      {
        category: 'unclassified',
        detail: 'haltReason=no_progress',
      },
    );
  });
});
