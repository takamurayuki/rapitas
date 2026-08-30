/**
 * incident-signature-detectors.pattern-b-grace.test
 *
 * Pattern B (`todo_status_workflow_advanced`) recovery-grace boundary tests,
 * split out of incident-signature-detectors.test.ts (task 709) to keep that
 * file from growing past the component size limit. Covers every
 * RECOVERY_REQUEUE_CAUSES member: the deliberate `status='todo'` × advanced
 * `workflowStatus` shape must NOT be reported as an anomaly within the grace
 * window after any of them.
 */
import { describe, it, expect } from 'bun:test';
import {
  detectTriStateDesync,
  DESYNC_RECOVERY_SETTLE_MS,
  type TriStateDesyncInput,
} from './incident-signature-detectors';

const NOW = 1_000_000_000_000;

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

  // #680 repro: task #672 retried via task-retry-handler (cause=task_retried),
  // which resets status to 'todo' while rolling workflowStatus back to
  // research_done. The watcher's next pass fired Pattern B ~139s later.
  it('does NOT detect pattern B 139s after a task_retried recovery (#680/#672 repro)', () => {
    expect(
      detectTriStateDesync({
        ...requeued,
        workflowStatus: 'research_done',
        latestTransitionCause: 'task_retried',
        latestTransitionAtMs: NOW - 139_000,
      }),
    ).toBeNull();
  });

  it('detects again once a task_retried recovery settled past the threshold', () => {
    const result = detectTriStateDesync({
      ...requeued,
      workflowStatus: 'research_done',
      latestTransitionCause: 'task_retried',
      latestTransitionAtMs: NOW - DESYNC_RECOVERY_SETTLE_MS,
    });
    expect(result?.kind).toBe('todo_status_workflow_advanced');
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

// task #715: a retry against a theme with auto-run disabled resets status to
// 'todo' while leaving workflowStatus mid-phase, exactly like the recovery
// causes above — but since a paused theme never dispatches, the shape never
// settles and Pattern B fired forever (tasks #602/#646/#647, themeId=25).
describe('pattern B suppressed by a disabled theme auto-run (#715)', () => {
  const pausedThemeTask: TriStateDesyncInput = {
    taskStatus: 'todo',
    workflowStatus: 'in_progress',
    latestSessionStatus: null,
    latestExecutionStatus: null,
    latestTransitionCause: 'verify_validation_failed',
    latestTransitionAtMs: NOW - 4 * 24 * 60 * 60 * 1000,
    nowMs: NOW,
    themeAutoRunEnabled: false,
  };

  it('does NOT detect pattern B when the theme auto-run is disabled, however long it has waited', () => {
    expect(detectTriStateDesync(pausedThemeTask)).toBeNull();
  });

  it('still detects pattern B when the theme auto-run is enabled', () => {
    const result = detectTriStateDesync({ ...pausedThemeTask, themeAutoRunEnabled: true });
    expect(result?.kind).toBe('todo_status_workflow_advanced');
  });

  it('still detects pattern B when the theme auto-run state is unresolved (fail open)', () => {
    const result = detectTriStateDesync({ ...pausedThemeTask, themeAutoRunEnabled: null });
    expect(result?.kind).toBe('todo_status_workflow_advanced');
  });

  it('still detects pattern B when themeAutoRunEnabled is simply omitted (fail open)', () => {
    const { themeAutoRunEnabled: _omitted, ...withoutThemeState } = pausedThemeTask;
    expect(detectTriStateDesync(withoutThemeState)?.kind).toBe('todo_status_workflow_advanced');
  });

  it('does NOT let a disabled theme auto-run suppress pattern A', () => {
    const result = detectTriStateDesync({
      ...pausedThemeTask,
      latestSessionStatus: 'failed',
      latestExecutionStatus: 'running',
    });
    expect(result?.kind).toBe('session_failed_execution_active');
  });
});

// task #769 / task #755: auto_approve_plan (not in RECOVERY_REQUEUE_CAUSES)
// advanced workflowStatus to plan_approved while task.status stayed 'todo'
// because the task was still sitting in the dispatch queue — Pattern B fired
// on a normal pre-dispatch wait since detectTriStateDesync never received the
// same hasActiveQueueItem signal detectStagnation already uses.
describe('pattern B suppressed by an active queue item (#769)', () => {
  const queuedTask: TriStateDesyncInput = {
    taskStatus: 'todo',
    workflowStatus: 'plan_approved',
    latestSessionStatus: null,
    latestExecutionStatus: null,
    latestTransitionCause: 'auto_approve_plan',
    latestTransitionAtMs: NOW - 60_000,
    nowMs: NOW,
    hasActiveQueueItem: true,
  };

  it('does NOT detect pattern B when an active queue item exists, regardless of cause', () => {
    expect(detectTriStateDesync(queuedTask)).toBeNull();
  });

  it('still detects pattern B when there is no active queue item', () => {
    const result = detectTriStateDesync({ ...queuedTask, hasActiveQueueItem: false });
    expect(result?.kind).toBe('todo_status_workflow_advanced');
  });

  it('still detects pattern B when hasActiveQueueItem is simply omitted (fail open)', () => {
    const { hasActiveQueueItem: _omitted, ...withoutQueueState } = queuedTask;
    expect(detectTriStateDesync(withoutQueueState)?.kind).toBe('todo_status_workflow_advanced');
  });

  it('does NOT let an active queue item suppress pattern A', () => {
    const result = detectTriStateDesync({
      ...queuedTask,
      latestSessionStatus: 'failed',
      latestExecutionStatus: 'running',
    });
    expect(result?.kind).toBe('session_failed_execution_active');
  });
});

// task 709 / task #602: three more code paths revert status to 'todo' without
// changing workflowStatus (backend shutdown, manual stop, stale-execution
// recovery). Before task 709 none recorded a transition, so the grace guard
// had no row to find and Pattern B fired immediately on the shape those
// paths create on purpose.
describe.each([
  ['agent_lifecycle_shutdown_revert', 'backend shutdown (lifecycle-manager.ts)'],
  ['manual_execution_stop_revert', 'manual stop (stop-route.ts)'],
  ['stale_execution_recovery_revert', 'stale-execution recovery (stale-recovery-helpers.ts)'],
])('pattern B recovery grace for %s — %s', (cause) => {
  const reverted: TriStateDesyncInput = {
    taskStatus: 'todo',
    workflowStatus: 'in_progress',
    latestSessionStatus: null,
    latestExecutionStatus: null,
    latestTransitionCause: cause,
    latestTransitionAtMs: NOW - 60_000,
    nowMs: NOW,
  };

  it('does NOT detect pattern B shortly after the revert', () => {
    expect(detectTriStateDesync(reverted)).toBeNull();
  });

  it('detects again once the revert settled past the threshold', () => {
    const result = detectTriStateDesync({
      ...reverted,
      latestTransitionAtMs: NOW - DESYNC_RECOVERY_SETTLE_MS,
    });
    expect(result?.kind).toBe('todo_status_workflow_advanced');
  });
});
