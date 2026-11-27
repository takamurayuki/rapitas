/**
 * awaiting-ci.test
 *
 * Task 1568: the CI-wait shape is recognised from the queue item's phase and the task's held state.
 */
import { describe, test, expect } from 'bun:test';
import { AWAITING_CI_PHASE, isAwaitingCiItem, isCiWaitTask } from './awaiting-ci';

describe('isAwaitingCiItem', () => {
  test('true only for the awaiting_ci phase', () => {
    expect(isAwaitingCiItem({ currentPhase: AWAITING_CI_PHASE })).toBe(true);
    expect(isAwaitingCiItem({ currentPhase: 'awaiting_merge' })).toBe(false);
    expect(isAwaitingCiItem({ currentPhase: null })).toBe(false);
    expect(isAwaitingCiItem(null)).toBe(false);
  });
});

describe('isCiWaitTask', () => {
  test('true only for in-progress + verify_done', () => {
    expect(isCiWaitTask({ status: 'in-progress', workflowStatus: 'verify_done' })).toBe(true);
    expect(isCiWaitTask({ status: 'done', workflowStatus: 'verify_done' })).toBe(false);
    expect(isCiWaitTask({ status: 'in-progress', workflowStatus: 'completed' })).toBe(false);
    expect(isCiWaitTask({ status: 'todo', workflowStatus: null })).toBe(false);
    expect(isCiWaitTask(null)).toBe(false);
  });
});
