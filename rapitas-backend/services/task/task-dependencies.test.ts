/**
 * task-dependencies.test
 *
 * 開始条件 (#1559): a task waits for the tasks it depends on to be done.
 * Setting them must refuse what could never finish — itself, an unknown
 * task, a cycle — and selection must leave a waiting task alone.
 */
import { describe, it, expect } from 'bun:test';
import {
  UNMET_DEPENDENCIES_EXCLUDED,
  findCycle,
  prerequisitesMessage,
  validateDependencies,
} from './task-dependencies';

describe('setting what a task waits for', () => {
  const known = new Set([1, 2, 3, 4]);

  it('accepts other existing tasks', () => {
    expect(validateDependencies(1, [2, 3], known, [])).toEqual({ ok: true, ids: [2, 3] });
  });

  it('drops duplicates', () => {
    expect(validateDependencies(1, [2, 2], known, [])).toEqual({ ok: true, ids: [2] });
  });

  it('refuses the task itself', () => {
    expect(validateDependencies(1, [1], known, [])).toMatchObject({ ok: false, code: 'self' });
  });

  it('refuses a task that does not exist', () => {
    expect(validateDependencies(1, [9], known, [])).toMatchObject({ ok: false, code: 'unknown' });
  });

  // 2 waits for 1; making 1 wait for 2 would leave both waiting forever.
  it('refuses a cycle, and names it', () => {
    const r = validateDependencies(1, [2], known, [{ taskId: 2, dependsOnTaskId: 1 }]);
    expect(r).toMatchObject({ ok: false, code: 'cycle' });
  });

  it('finds a longer cycle', () => {
    const edges = [
      { taskId: 2, dependsOnTaskId: 3 },
      { taskId: 3, dependsOnTaskId: 1 },
    ];
    expect(findCycle(1, [2], edges)).toEqual([1, 2, 3, 1]);
    expect(findCycle(1, [4], edges)).toBeNull();
  });
});

describe('telling the person what it waits for', () => {
  it('names each open prerequisite', () => {
    const msg = prerequisitesMessage([
      { id: 12, title: 'API を作る', status: 'in-progress' },
      { id: 13, title: '画面を作る', status: 'todo' },
    ]);
    expect(msg).toContain('#12「API を作る」');
    expect(msg).toContain('#13「画面を作る」');
  });
});

describe('what selection leaves out', () => {
  // The same fragment goes into selectNextTask and eligibleTopLevelTodoWhere:
  // when they disagree a task is picked, refused and picked again (task 635).
  it('excludes a task with any prerequisite not done', () => {
    expect(UNMET_DEPENDENCIES_EXCLUDED).toEqual({
      dependencies: { none: { dependsOn: { status: { not: 'done' } } } },
    });
  });
});
