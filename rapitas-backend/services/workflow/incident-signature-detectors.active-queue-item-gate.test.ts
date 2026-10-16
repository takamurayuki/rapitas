/**
 * incident-signature-detectors.active-queue-item-gate.test
 *
 * Unit coverage for the `hasActiveQueueItem` gate on Pattern B
 * (`todo_status_workflow_advanced`, task #769 / PR #542 re-implementation
 * after the original PR went stale+DIRTY and was auto-closed, task #1104):
 * a task sitting in the auto-run queue (queued/running/waiting_approval)
 * with `status='todo'` and an already-advanced `workflowStatus` is a normal
 * pre-dispatch wait, not a stuck/corrupted state — detectStagnation already
 * excludes this shape via the same signal (incident-signature-detectors.ts
 * line ~288) but detectTriStateDesync never received it, so any transition
 * cause NOT in RECOVERY_REQUEUE_CAUSES (e.g. auto_approve_plan) fired
 * Pattern B on a queued task.
 */
import { describe, it, expect } from 'bun:test';
import { detectTriStateDesync, type TriStateDesyncInput } from './incident-signature-detectors';

const NOW = 1_000_000_000_000;

describe('detectTriStateDesync: hasActiveQueueItem gate on Pattern B (#769)', () => {
  const patternB: TriStateDesyncInput = {
    taskStatus: 'todo',
    workflowStatus: 'plan_approved',
    latestSessionStatus: null,
    latestExecutionStatus: null,
    latestTransitionCause: 'auto_approve_plan',
    latestTransitionAtMs: NOW - 10 * 60_000,
    nowMs: NOW,
  };

  it('does NOT report todo × advanced when the task has an active queue item', () => {
    expect(detectTriStateDesync({ ...patternB, hasActiveQueueItem: true })).toBeNull();
  });

  it('still reports todo × advanced when hasActiveQueueItem is false', () => {
    const result = detectTriStateDesync({ ...patternB, hasActiveQueueItem: false });
    expect(result).not.toBeNull();
    expect(result?.kind).toBe('todo_status_workflow_advanced');
  });

  it('still reports todo × advanced when hasActiveQueueItem is unspecified (fail-open)', () => {
    const result = detectTriStateDesync(patternB);
    expect(result).not.toBeNull();
    expect(result?.kind).toBe('todo_status_workflow_advanced');
  });

  it('Pattern A is unaffected by hasActiveQueueItem=true (gate does not leak)', () => {
    const patternA: TriStateDesyncInput = {
      taskStatus: 'in-progress',
      workflowStatus: 'in_progress',
      latestSessionStatus: 'failed',
      latestExecutionStatus: 'running',
      hasActiveQueueItem: true,
      nowMs: NOW,
    };
    const result = detectTriStateDesync(patternA);
    expect(result).not.toBeNull();
    expect(result?.kind).toBe('session_failed_execution_active');
  });
});
