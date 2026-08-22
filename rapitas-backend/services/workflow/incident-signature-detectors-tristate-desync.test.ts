/**
 * incident-signature-detectors-tristate-desync.test
 *
 * Boundary tests for detectTriStateDesync: pattern A (session failed while
 * execution active) and pattern B (task still todo while workflow advanced),
 * including the #636 recovery-grace window that keeps a deliberate requeue
 * from being misreported as pattern B.
 * No DB, no mocks — every input is a plain snapshot.
 */
import { describe, it, expect } from 'bun:test';
import {
  detectTriStateDesync,
  DESYNC_RECOVERY_SETTLE_MS,
  type TriStateDesyncInput,
} from './incident-signature-detectors';

const NOW = 1_000_000_000_000;

describe('detectTriStateDesync', () => {
  const consistent: TriStateDesyncInput = {
    taskStatus: 'in-progress',
    workflowStatus: 'in_progress',
    latestSessionStatus: 'active',
    latestExecutionStatus: 'running',
  };

  it('detects pattern A: session failed while execution still active', () => {
    const result = detectTriStateDesync({
      ...consistent,
      latestSessionStatus: 'failed',
      latestExecutionStatus: 'running',
    });
    expect(result?.kind).toBe('session_failed_execution_active');
    expect(result?.detail).toContain('failed');
    expect(result?.detail).toContain('running');
  });

  it('detects pattern A for a cancelled session with a pending execution', () => {
    const result = detectTriStateDesync({
      ...consistent,
      latestSessionStatus: 'cancelled',
      latestExecutionStatus: 'pending',
    });
    expect(result?.kind).toBe('session_failed_execution_active');
  });

  it('detects pattern B: task still todo while the workflow advanced', () => {
    const result = detectTriStateDesync({
      taskStatus: 'todo',
      workflowStatus: 'plan_created',
      latestSessionStatus: null,
      latestExecutionStatus: null,
    });
    expect(result?.kind).toBe('todo_status_workflow_advanced');
    expect(result?.detail).toContain('plan_created');
  });

  it.each(['draft', null])('does NOT detect pattern B for workflowStatus=%p', (wf) => {
    expect(
      detectTriStateDesync({
        taskStatus: 'todo',
        workflowStatus: wf,
        latestSessionStatus: null,
        latestExecutionStatus: null,
      }),
    ).toBeNull();
  });

  it('does NOT detect pattern B when the workflow paused on a question', () => {
    expect(
      detectTriStateDesync({
        taskStatus: 'todo',
        workflowStatus: 'awaiting_question',
        latestSessionStatus: null,
        latestExecutionStatus: null,
      }),
    ).toBeNull();
  });

  it('does NOT detect pattern B when taskStatus is not todo', () => {
    expect(
      detectTriStateDesync({
        taskStatus: 'in-progress',
        workflowStatus: 'in_progress',
        latestSessionStatus: null,
        latestExecutionStatus: null,
      }),
    ).toBeNull();
  });

  it('does NOT detect when the session failed but the execution also terminated', () => {
    expect(
      detectTriStateDesync({
        ...consistent,
        latestSessionStatus: 'failed',
        latestExecutionStatus: 'failed',
      }),
    ).toBeNull();
  });

  it('does NOT detect a session-less, execution-less consistent snapshot', () => {
    expect(
      detectTriStateDesync({
        taskStatus: 'todo',
        workflowStatus: 'draft',
        latestSessionStatus: null,
        latestExecutionStatus: null,
      }),
    ).toBeNull();
  });

  it('prefers pattern A when both patterns apply simultaneously', () => {
    const result = detectTriStateDesync({
      taskStatus: 'todo',
      workflowStatus: 'in_progress',
      latestSessionStatus: 'failed',
      latestExecutionStatus: 'waiting_for_input',
    });
    expect(result?.kind).toBe('session_failed_execution_active');
  });

  // #636 repro: requeueOrphanTasks deliberately resets status to 'todo' while
  // keeping workflowStatus (plan_approved) so auto-run can resume mid-workflow.
  // The watcher fired Pattern B 59s later and filed a high-severity bug for a
  // state the reconciler had just created on purpose.
  describe('pattern B recovery grace (#636)', () => {
    const requeued: TriStateDesyncInput = {
      taskStatus: 'todo',
      workflowStatus: 'plan_approved',
      latestSessionStatus: 'cancelled',
      latestExecutionStatus: 'completed',
      latestTransitionCause: 'reconciler_requeue',
      latestTransitionAtMs: NOW - 59_000,
      nowMs: NOW,
    };

    it('does NOT detect pattern B 59s after a reconciler_requeue recovery (#636 repro)', () => {
      expect(detectTriStateDesync(requeued)).toBeNull();
    });

    it('does NOT detect pattern B shortly after an artifact_reuse_fastforward', () => {
      expect(
        detectTriStateDesync({
          ...requeued,
          workflowStatus: 'plan_created',
          latestTransitionCause: 'artifact_reuse_fastforward',
        }),
      ).toBeNull();
    });

    it('detects again once the recovery transition settled past the threshold (>= boundary)', () => {
      const settled = {
        ...requeued,
        latestTransitionAtMs: NOW - DESYNC_RECOVERY_SETTLE_MS,
      };
      const result = detectTriStateDesync(settled);
      expect(result?.kind).toBe('todo_status_workflow_advanced');
      // 1ms inside the grace window → still skipped.
      expect(
        detectTriStateDesync({
          ...settled,
          latestTransitionAtMs: NOW - DESYNC_RECOVERY_SETTLE_MS + 1,
        }),
      ).toBeNull();
    });

    it('honors a custom settleMs override', () => {
      const custom = { ...requeued, latestTransitionAtMs: NOW - 5_000, settleMs: 4_000 };
      expect(detectTriStateDesync(custom)?.kind).toBe('todo_status_workflow_advanced');
      expect(detectTriStateDesync({ ...custom, settleMs: 6_000 })).toBeNull();
    });

    it('still detects when the latest transition cause is not a recovery cause', () => {
      const result = detectTriStateDesync({
        ...requeued,
        latestTransitionCause: 'file_saved:plan',
      });
      expect(result?.kind).toBe('todo_status_workflow_advanced');
    });

    it('still detects a recovery cause whose transition time is unknown (conservative)', () => {
      expect(detectTriStateDesync({ ...requeued, latestTransitionAtMs: null })?.kind).toBe(
        'todo_status_workflow_advanced',
      );
    });

    it('still detects a recovery cause when nowMs is not supplied (conservative)', () => {
      const { nowMs: _omitted, ...withoutNow } = requeued;
      expect(detectTriStateDesync(withoutNow)?.kind).toBe('todo_status_workflow_advanced');
    });

    it('does NOT let the grace window suppress pattern A', () => {
      const result = detectTriStateDesync({
        ...requeued,
        latestSessionStatus: 'failed',
        latestExecutionStatus: 'running',
      });
      expect(result?.kind).toBe('session_failed_execution_active');
    });
  });
});
