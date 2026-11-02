/**
 * role-model-outcomes-scoring.test
 *
 * Which model ran which phase, scored against what the task then did.
 *
 * The existing cost-optimization panel already groups executions by role and
 * model, but its outcome axis is `status === 'completed'` — the CLI exiting
 * cleanly. Measured 2026-10-21 over 500 executions that axis is saturated:
 * sonnet 100%, opus 98%, haiku 100%. It cannot tell two models apart, so it
 * cannot answer whether the cheaper one implements the requirement as
 * faithfully.
 *
 * The axis with real variance is the repair loop: 37 `verify_repair`
 * transitions against 59 verify saves in the same fortnight. So these tests
 * are about scoring a phase's model by what happened to the task afterwards,
 * and about refusing to report a rate off a handful of tasks — at n=5 and n=8
 * a measurement in this repository reversed itself, and only the interval at
 * n=12 was honest.
 */
import { describe, expect, test } from 'bun:test';
import {
  MIN_TASKS_FOR_RATE,
  summariseCombinations,
  summariseRoleModels,
  type ExecutionRow,
  type TaskOutcome,
} from './role-model-outcomes-scoring';

const exec = (
  taskId: number,
  role: string | null,
  model: string | null,
  extra: Partial<ExecutionRow> = {},
): ExecutionRow => ({
  taskId,
  role,
  model,
  attributedCostUsd: 1,
  executionTimeMs: 1000,
  startedAt: new Date(2026, 9, 21, 0, taskId),
  ...extra,
});

const outcome = (taskId: number, bounces: number, completed = true): TaskOutcome => ({
  taskId,
  bounces,
  completed,
});

/** n tasks on one (role, model), all with the given bounce count. */
const fleet = (n: number, model: string, bounces: number, from = 1) => {
  const execs: ExecutionRow[] = [];
  const outcomes: TaskOutcome[] = [];
  for (let i = 0; i < n; i++) {
    execs.push(exec(from + i, 'implementer', model));
    outcomes.push(outcome(from + i, bounces));
  }
  return { execs, outcomes };
};

describe('scoring one role and model', () => {
  test('counts executions and the distinct tasks behind them', () => {
    const rows = [
      exec(1, 'implementer', 'sonnet'),
      exec(1, 'implementer', 'sonnet'),
      exec(2, 'implementer', 'sonnet'),
    ];
    const [cell] = summariseRoleModels(rows, [outcome(1, 1), outcome(2, 0)]);
    expect(cell).toMatchObject({ role: 'implementer', model: 'sonnet', executions: 3, tasks: 2 });
  });

  test('scores the phase by what the task did next, not by the CLI exiting', () => {
    const { execs, outcomes } = fleet(MIN_TASKS_FOR_RATE, 'sonnet', 0);
    const [cell] = summariseRoleModels(execs, outcomes);
    expect(cell.firstPassRate).toBe(1);
    expect(cell.meanBounces).toBe(0);
  });

  test('separates two models on the same role', () => {
    const a = fleet(MIN_TASKS_FOR_RATE, 'sonnet', 0, 1);
    const b = fleet(MIN_TASKS_FOR_RATE, 'opus', 2, 100);
    const cells = summariseRoleModels([...a.execs, ...b.execs], [...a.outcomes, ...b.outcomes]);
    const byModel = Object.fromEntries(cells.map((c) => [c.model, c]));
    expect(byModel.sonnet.firstPassRate).toBe(1);
    expect(byModel.opus.firstPassRate).toBe(0);
    expect(byModel.opus.meanBounces).toBe(2);
  });

  test('refuses a rate it cannot support', () => {
    // At n=5 and n=8 a measurement in this repository reversed itself. A cell
    // this thin reports its counts and withholds the rate, so a consumer
    // cannot read noise as a finding.
    const { execs, outcomes } = fleet(MIN_TASKS_FOR_RATE - 1, 'haiku', 0);
    const [cell] = summariseRoleModels(execs, outcomes);
    expect(cell.tasks).toBe(MIN_TASKS_FOR_RATE - 1);
    expect(cell.firstPassRate).toBeNull();
    expect(cell.meanBounces).toBeNull();
  });

  test('still reports what it spent and how long it took', () => {
    // Cost and duration are per-execution facts; they do not need the task
    // population a rate needs.
    const [cell] = summariseRoleModels(
      [
        exec(1, 'implementer', 'opus', { attributedCostUsd: 2, executionTimeMs: 100 }),
        exec(2, 'implementer', 'opus', { attributedCostUsd: 3, executionTimeMs: 300 }),
      ],
      [outcome(1, 0), outcome(2, 0)],
    );
    expect(cell.costUsd).toBeCloseTo(5, 6);
    expect(cell.medianDurationMs).toBe(300);
  });

  test('ignores a row with no role or no model', () => {
    // 8 of 500 executions recorded no model. Bucketing them as "unknown"
    // would invent a model that never ran.
    const cells = summariseRoleModels(
      [exec(1, null, 'sonnet'), exec(2, 'implementer', null)],
      [outcome(1, 0), outcome(2, 0)],
    );
    expect(cells).toEqual([]);
  });

  test('ignores a task whose outcome is not known yet', () => {
    // A task still running has no bounce count; counting it as zero bounces
    // would make every in-flight task evidence for the model that started it.
    const { execs, outcomes } = fleet(MIN_TASKS_FOR_RATE, 'sonnet', 0);
    execs.push(exec(999, 'implementer', 'sonnet'));
    const [cell] = summariseRoleModels(execs, outcomes);
    expect(cell.tasks).toBe(MIN_TASKS_FOR_RATE);
  });

  test('sorts the thickest evidence first', () => {
    const a = fleet(3, 'haiku', 0, 1);
    const b = fleet(MIN_TASKS_FOR_RATE, 'sonnet', 0, 100);
    const cells = summariseRoleModels([...a.execs, ...b.execs], [...a.outcomes, ...b.outcomes]);
    expect(cells[0].model).toBe('sonnet');
  });
});

describe('scoring a combination of phases', () => {
  const pair = (taskId: number, implementer: string, verifier: string) => [
    exec(taskId, 'implementer', implementer),
    exec(taskId, 'verifier', verifier),
  ];

  test('keys a task by the model each named role ran', () => {
    const rows = [...pair(1, 'sonnet', 'opus'), ...pair(2, 'sonnet', 'opus')];
    const cells = summariseCombinations(
      rows,
      [outcome(1, 0), outcome(2, 1)],
      ['implementer', 'verifier'],
    );
    expect(cells).toHaveLength(1);
    expect(cells[0]).toMatchObject({
      tasks: 2,
      models: { implementer: 'sonnet', verifier: 'opus' },
    });
  });

  test('takes the LAST execution of a role, which is the one that produced the phase', () => {
    // A phase that times out and is re-dispatched has two executions; the
    // verdict belongs to the model that finished it.
    const rows = [
      exec(1, 'implementer', 'haiku', { startedAt: new Date(2026, 9, 21, 1, 0) }),
      exec(1, 'implementer', 'opus', { startedAt: new Date(2026, 9, 21, 2, 0) }),
    ];
    const cells = summariseCombinations(rows, [outcome(1, 0)], ['implementer']);
    expect(cells[0].models.implementer).toBe('opus');
  });

  test('drops a task that is missing one of the roles', () => {
    // A combination is a claim about all the named phases together; filling a
    // gap with "whatever ran" would attribute the outcome to a phase that
    // never ran under that model.
    const rows = [...pair(1, 'sonnet', 'opus'), exec(2, 'implementer', 'sonnet')];
    const cells = summariseCombinations(
      rows,
      [outcome(1, 0), outcome(2, 3)],
      ['implementer', 'verifier'],
    );
    expect(cells).toHaveLength(1);
    expect(cells[0].tasks).toBe(1);
  });

  test('withholds the rate on a thin combination but keeps the count', () => {
    const rows = pair(1, 'sonnet', 'opus');
    const cells = summariseCombinations(rows, [outcome(1, 0)], ['implementer', 'verifier']);
    expect(cells[0].tasks).toBe(1);
    expect(cells[0].firstPassRate).toBeNull();
  });
});
