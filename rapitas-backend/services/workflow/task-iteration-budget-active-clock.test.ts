/**
 * task-iteration-budget-active-clock test
 *
 * Pins the time-axis clock: it starts at the latest stretch of executions, and
 * idle time (no execution within the budget) never counts as iterating.
 */
import { describe, expect, test } from 'bun:test';
import { activeClockStartMs } from './task-iteration-budget-active-clock';
import { resolveIterationBudgetState } from './task-iteration-budget';

const H = 60 * 60 * 1000;
const BUDGET = 24 * H;
const WINDOW = 1_000 * H;

describe('activeClockStartMs', () => {
  test('no execution in the window: nothing is being iterated, clock starts now', () => {
    expect(activeClockStartMs([], WINDOW, WINDOW + 400 * H, BUDGET)).toBe(WINDOW + 400 * H);
    expect(activeClockStartMs([null, undefined], WINDOW, WINDOW + 400 * H, BUDGET)).toBe(
      WINDOW + 400 * H,
    );
  });

  test('re-selected after an idle gap longer than the budget: clock restarts now (#911)', () => {
    // Last reset 2026-09-10, executions that day, held for 15 days, re-selected.
    const starts = [WINDOW + 1 * H, WINDOW + 2 * H, WINDOW + 3 * H];
    const now = WINDOW + 15 * 24 * H;
    expect(activeClockStartMs(starts, WINDOW, now, BUDGET)).toBe(now);
  });

  test('a dense run of executions keeps the clock at the first one (loop still halts)', () => {
    const starts = [WINDOW + 1 * H, WINDOW + 5 * H, WINDOW + 20 * H];
    const now = WINDOW + 23 * H;
    expect(activeClockStartMs(starts, WINDOW, now, BUDGET)).toBe(WINDOW + 1 * H);
  });

  test('an idle gap inside the window starts a new stretch at the execution after it', () => {
    const starts = [WINDOW + 1 * H, WINDOW + 2 * H, WINDOW + 60 * H, WINDOW + 61 * H];
    const now = WINDOW + 70 * H;
    expect(activeClockStartMs(starts, WINDOW, now, BUDGET)).toBe(WINDOW + 60 * H);
  });

  test('never starts before the window (an execution that began pre-reset is clamped)', () => {
    const starts = [WINDOW - 5 * H, WINDOW + 1 * H];
    expect(activeClockStartMs(starts, WINDOW, WINDOW + 2 * H, BUDGET)).toBe(WINDOW);
  });
});

describe('resolveIterationBudgetState — time axis uses the active clock', () => {
  const base = {
    spentUsd: 0,
    attemptsInWindow: 1,
    repeatLoop: null,
    statusRepeatCount: 0,
  };

  test('window age alone no longer halts when the active clock is fresh', () => {
    const now = WINDOW + 15 * 24 * H;
    const state = resolveIterationBudgetState({
      ...base,
      nowMs: now,
      windowStartMs: WINDOW,
      activeClockStartMs: now - 3_000,
    });
    expect(state.shouldHalt).toBe(false);
  });

  test('still halts once the active stretch itself exceeds the budget', () => {
    const now = WINDOW + 30 * H;
    const state = resolveIterationBudgetState({
      ...base,
      nowMs: now,
      windowStartMs: WINDOW,
      activeClockStartMs: WINDOW + 1 * H,
    });
    expect(state).toMatchObject({ shouldHalt: true, haltReason: 'budget_time_exceeded' });
  });

  test('falls back to the window start when no active clock is supplied', () => {
    const state = resolveIterationBudgetState({
      ...base,
      nowMs: WINDOW + 30 * H,
      windowStartMs: WINDOW,
    });
    expect(state).toMatchObject({ shouldHalt: true, haltReason: 'budget_time_exceeded' });
  });
});
