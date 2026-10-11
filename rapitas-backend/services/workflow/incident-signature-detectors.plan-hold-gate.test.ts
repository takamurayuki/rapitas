/**
 * incident-signature-detectors.plan-hold-gate.test
 *
 * detectStagnation must not file a stagnation finding for a todo × plan_created task
 * whose newest transition is a fresh plan_forbidden_change_hold (task #1205): the wait
 * is a human override approval, not an orphan. Stale / unresolved evidence fails open.
 */
import { describe, it, expect } from 'bun:test';
import {
  detectStagnation,
  STAGNATION_THRESHOLD_MS,
  type StagnationInput,
} from './incident-signature-detectors';
import { PLAN_HOLD_EXCLUSION_WINDOW_MS, PLAN_HOLD_CAUSE } from './plan-hold-exclusion';
import { PLAN_FORBIDDEN_CHANGE_HOLD_CAUSE } from './forbidden-change-plan-hold';

const NOW = 1_000_000_000_000;

describe('detectStagnation: plan hold gate (#1205)', () => {
  const held: StagnationInput = {
    taskStatus: 'todo',
    workflowStatus: 'plan_created',
    lastActivityAtMs: NOW - 21 * 60 * 60_000,
    hasLiveExecution: false,
    hasAnyExecution: true,
    hasActiveQueueItem: false,
    latestTransitionCause: 'plan_forbidden_change_hold',
    latestPlanHoldAtMs: NOW - 21 * 60 * 60_000,
    nowMs: NOW,
  };

  it('pins the cause constant to the producer module', () => {
    expect(PLAN_HOLD_CAUSE).toBe(PLAN_FORBIDDEN_CHANGE_HOLD_CAUSE);
  });

  it('returns null for a fresh plan hold', () => {
    expect(detectStagnation(held)).toBeNull();
  });

  it('detects once the hold is older than the exclusion window', () => {
    const stale = NOW - PLAN_HOLD_EXCLUSION_WINDOW_MS - 1;
    expect(
      detectStagnation({ ...held, latestPlanHoldAtMs: stale, lastActivityAtMs: stale }),
    ).not.toBeNull();
  });

  it('detects exactly at the window boundary', () => {
    expect(
      detectStagnation({ ...held, latestPlanHoldAtMs: NOW - PLAN_HOLD_EXCLUSION_WINDOW_MS }),
    ).not.toBeNull();
  });

  it('fails open when the hold time is unresolved', () => {
    expect(detectStagnation({ ...held, latestPlanHoldAtMs: null })).not.toBeNull();
    expect(detectStagnation({ ...held, latestPlanHoldAtMs: undefined })).not.toBeNull();
  });

  it('detects when the newest transition is not the hold', () => {
    expect(detectStagnation({ ...held, latestTransitionCause: 'task_retried' })).not.toBeNull();
  });

  it('does not exclude a non plan_created task even with a hold cause', () => {
    expect(detectStagnation({ ...held, workflowStatus: 'plan_approved' })).not.toBeNull();
  });

  it('keeps the threshold: a fresh-activity hold is simply not stale', () => {
    expect(
      detectStagnation({
        ...held,
        latestTransitionCause: null,
        lastActivityAtMs: NOW - STAGNATION_THRESHOLD_MS + 1,
      }),
    ).toBeNull();
  });
});
