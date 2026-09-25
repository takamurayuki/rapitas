/**
 * incident-signature-detectors.theme-busy-gate.test
 *
 * Unit coverage for the `themeAutoRunBusyWithOtherTask` gate (task #969):
 * a task waiting on a theme that is actively dispatching a DIFFERENT task
 * must not be reported as stagnant or desynced — AUTO_RUN_GLOBAL_MAX_
 * CONCURRENCY defaults to 1, so a busy theme's backlog routinely waits past
 * STAGNATION_THRESHOLD_MS with no execution/queue item of its own. A task
 * that IS the theme's currentTaskId must still be detected — that shape is a
 * live hang on the task's own turn, not a normal backlog wait.
 */
import { describe, it, expect } from 'bun:test';
import {
  detectStagnation,
  detectTriStateDesync,
  STAGNATION_THRESHOLD_MS,
  type StagnationInput,
  type TriStateDesyncInput,
} from './incident-signature-detectors';

const NOW = 1_000_000_000_000;

describe('detectStagnation: themeAutoRunBusyWithOtherTask gate (#969)', () => {
  const stagnant: StagnationInput = {
    taskStatus: 'todo',
    workflowStatus: 'draft',
    lastActivityAtMs: NOW - STAGNATION_THRESHOLD_MS - 60_000,
    hasLiveExecution: false,
    hasAnyExecution: true,
    hasActiveQueueItem: false,
    nowMs: NOW,
  };

  it('does NOT detect stagnation when the theme is busy dispatching a different task', () => {
    expect(detectStagnation({ ...stagnant, themeAutoRunBusyWithOtherTask: true })).toBeNull();
  });

  it('still detects stagnation when themeAutoRunBusyWithOtherTask is false', () => {
    expect(detectStagnation({ ...stagnant, themeAutoRunBusyWithOtherTask: false })).not.toBeNull();
  });

  it('still detects stagnation when themeAutoRunBusyWithOtherTask is unspecified (fail-open)', () => {
    expect(detectStagnation(stagnant)).not.toBeNull();
  });

  it('still detects stagnation when the theme is running but currentTaskId is this task itself', () => {
    // Caller derives themeAutoRunBusyWithOtherTask=false when currentTaskId
    // matches the task's own id — a live hang on the task's own turn.
    expect(detectStagnation({ ...stagnant, themeAutoRunBusyWithOtherTask: false })).not.toBeNull();
  });
});

describe('detectTriStateDesync: themeAutoRunBusyWithOtherTask gate on Pattern B (#969)', () => {
  const patternB: TriStateDesyncInput = {
    taskStatus: 'todo',
    workflowStatus: 'research_done',
    latestSessionStatus: null,
    latestExecutionStatus: null,
    nowMs: NOW,
  };

  it('does NOT detect Pattern B when the theme is busy dispatching a different task', () => {
    expect(detectTriStateDesync({ ...patternB, themeAutoRunBusyWithOtherTask: true })).toBeNull();
  });

  it('still detects Pattern B when themeAutoRunBusyWithOtherTask is false', () => {
    const result = detectTriStateDesync({ ...patternB, themeAutoRunBusyWithOtherTask: false });
    expect(result).not.toBeNull();
    expect(result?.kind).toBe('todo_status_workflow_advanced');
  });

  it('still detects Pattern B when themeAutoRunBusyWithOtherTask is unspecified (fail-open)', () => {
    const result = detectTriStateDesync(patternB);
    expect(result).not.toBeNull();
    expect(result?.kind).toBe('todo_status_workflow_advanced');
  });

  it('Pattern A is unaffected by themeAutoRunBusyWithOtherTask=true (gate does not leak)', () => {
    const patternA: TriStateDesyncInput = {
      taskStatus: 'in-progress',
      workflowStatus: 'in_progress',
      latestSessionStatus: 'failed',
      latestExecutionStatus: 'running',
      themeAutoRunBusyWithOtherTask: true,
      nowMs: NOW,
    };
    const result = detectTriStateDesync(patternA);
    expect(result).not.toBeNull();
    expect(result?.kind).toBe('session_failed_execution_active');
  });
});

describe('detectTriStateDesync: taskHalted gate on Pattern B (#1003)', () => {
  const patternB: TriStateDesyncInput = {
    taskStatus: 'todo',
    workflowStatus: 'in_progress',
    latestSessionStatus: null,
    latestExecutionStatus: null,
    nowMs: NOW,
  };

  it('does NOT report todo × advanced when the task is halted by the iteration budget', () => {
    expect(detectTriStateDesync({ ...patternB, taskHalted: true })).toBeNull();
  });

  it('does NOT report todo × advanced when the operator opted the task out of auto-run (#907)', () => {
    expect(detectTriStateDesync({ ...patternB, autoRunExcluded: true })).toBeNull();
  });

  it('still reports todo × advanced when the task is not halted', () => {
    expect(detectTriStateDesync({ ...patternB, taskHalted: false })?.kind).toBe(
      'todo_status_workflow_advanced',
    );
  });
});
