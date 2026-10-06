/**
 * queue-terminal-task-guard.test
 *
 * Pins the halt predicate against the stale-haltReason state measured on
 * 2026-10-06: 4 of the 6 tasks carrying a haltReason were already status=done
 * (#1031/#1060/#1110/#1112), because nothing clears the column on completion.
 * The overlap guard asks this predicate whether a linked task is halted, and
 * answering "yes" for a finished task silently disables the hold.
 */
import { describe, test, expect } from 'bun:test';
import { isTaskTerminalForQueue, isTaskHaltActive } from './queue-terminal-task-guard';

describe('isTaskTerminalForQueue', () => {
  test('done / cancelled / workflow completed are terminal', () => {
    expect(isTaskTerminalForQueue({ status: 'done' })).toBe(true);
    expect(isTaskTerminalForQueue({ status: 'cancelled' })).toBe(true);
    expect(isTaskTerminalForQueue({ workflowStatus: 'completed' })).toBe(true);
  });

  test('an in-flight task is not terminal, and a failed lookup is not either', () => {
    expect(isTaskTerminalForQueue({ status: 'in_progress' })).toBe(false);
    expect(isTaskTerminalForQueue(null)).toBe(false);
  });
});

describe('isTaskHaltActive', () => {
  test('a halted in-flight task is halted', () => {
    expect(
      isTaskHaltActive({
        haltReason: 'budget_cost_exceeded',
        status: 'todo',
        workflowStatus: 'in_progress',
      }),
    ).toBe(true);
  });

  // The load-bearing case: the four measured rows all look like this.
  test('a finished task that still carries a haltReason is NOT halted', () => {
    expect(
      isTaskHaltActive({
        haltReason: 'budget_cost_exceeded',
        status: 'done',
        workflowStatus: 'completed',
      }),
    ).toBe(false);
  });

  test('status=done alone is enough, even without workflowStatus', () => {
    expect(isTaskHaltActive({ haltReason: 'budget_cost_exceeded', status: 'done' })).toBe(false);
  });

  test('a cancelled task that still carries a haltReason is NOT halted', () => {
    expect(isTaskHaltActive({ haltReason: 'budget_time_exceeded', status: 'cancelled' })).toBe(
      false,
    );
  });

  test('no haltReason means not halted, whatever the status', () => {
    expect(isTaskHaltActive({ haltReason: null, status: 'in_progress' })).toBe(false);
    expect(isTaskHaltActive({ status: 'in_progress' })).toBe(false);
  });

  // A failed lookup must not read as halted — same fail-open rule as the
  // terminal predicate, so a transient DB error cannot silently drop a PR.
  test('a failed lookup is not halted', () => {
    expect(isTaskHaltActive(null)).toBe(false);
  });
});
