import { expect, test } from 'bun:test';
import {
  rejectReplanLifecycle,
  isRequirementReplanWindowExhausted,
  type ReplanLifecycleSnapshot,
} from './requirement-replan-policy';

const now = new Date('2026-09-08T00:00:00Z');
const current: ReplanLifecycleSnapshot = {
  status: 'in-progress',
  workflowStatus: 'plan_approved',
  updatedAt: now,
  latestExecutionStatus: 'completed',
  latestStopCause: null,
  themeStatus: 'running',
  priorReplans: 0,
};

test('only admits the current active task with remaining budget', () => {
  expect(rejectReplanLifecycle(current, now)).toBeNull();
  expect(rejectReplanLifecycle({ ...current, updatedAt: new Date(now.getTime() + 1) }, now)).toBe(
    'stale_task',
  );
  for (const status of ['done', 'todo', 'blocked', 'cancelled', 'archived', 'failed']) {
    expect(rejectReplanLifecycle({ ...current, status }, now)).toBe('protected_task_status');
  }
  for (const workflowStatus of [null, 'completed', 'awaiting_question', 'draft']) {
    expect(rejectReplanLifecycle({ ...current, workflowStatus }, now)).toBe(
      'protected_workflow_status',
    );
  }
});

test('cancelled execution blocks even when task status was not reset (task912)', () => {
  expect(rejectReplanLifecycle({ ...current, latestExecutionStatus: 'cancelled' }, now)).toBe(
    'execution_stopped',
  );
  expect(rejectReplanLifecycle({ ...current, latestStopCause: 'auto_run_stop_revert' }, now)).toBe(
    'stop_not_resumed',
  );
  for (const themeStatus of ['stopping', 'paused', 'paused_approval']) {
    expect(rejectReplanLifecycle({ ...current, themeStatus }, now)).toBe('theme_paused');
  }
});

test('invalid or exhausted persistent budgets never admit another replan', () => {
  for (const priorReplans of [-1, NaN, Infinity, 1.5]) {
    expect(rejectReplanLifecycle({ ...current, priorReplans }, now)).toBe('invalid_budget');
  }
  expect(rejectReplanLifecycle({ ...current, priorReplans: 3 }, now)).toBe('budget_exhausted');
});

// Task #917 timeline (task 956): requirement_evidence_replan at 10:02:58.811Z
// and 10:18:56.775Z, with the 3rd phase_completed:implementer detected at
// 10:32:36.239Z — the window guard must trip at the 2nd replan, before that
// 3rd firing ever happens.
const replanAt1002 = { createdAtMs: new Date('2026-09-10T10:02:58.811Z').getTime() };
const replanAt1018 = { createdAtMs: new Date('2026-09-10T10:18:56.775Z').getTime() };

test('window guard is not exhausted with zero or one replan in the window', () => {
  expect(isRequirementReplanWindowExhausted([], replanAt1018.createdAtMs)).toBe(false);
  expect(isRequirementReplanWindowExhausted([replanAt1002], replanAt1002.createdAtMs)).toBe(false);
});

test('window guard exhausts at the 2nd replan within 60 minutes, before a 3rd implementer firing', () => {
  expect(
    isRequirementReplanWindowExhausted([replanAt1002, replanAt1018], replanAt1018.createdAtMs),
  ).toBe(true);
});

test('a replan just outside the 60-minute window is not counted (boundary)', () => {
  const nowMs = replanAt1018.createdAtMs;
  const justOutside = { createdAtMs: nowMs - 60 * 60 * 1000 - 1 };
  const justInside = { createdAtMs: nowMs - 60 * 60 * 1000 };
  // Only the boundary replan itself — one in-window transition never exhausts.
  expect(isRequirementReplanWindowExhausted([justOutside], nowMs)).toBe(false);
  expect(isRequirementReplanWindowExhausted([justInside], nowMs)).toBe(false);
  // A 2nd in-window replan (justInside + one more inside the window) exhausts;
  // the out-of-window one contributes nothing to the count.
  expect(isRequirementReplanWindowExhausted([justOutside, justInside, replanAt1018], nowMs)).toBe(
    true,
  );
});
