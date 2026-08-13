/**
 * incident-signature-detectors.test
 *
 * Boundary tests for the three pure incident detectors: each guard condition
 * flips detection off exactly once, and thresholds detect at >= (inclusive).
 * No DB, no mocks — every input is a plain snapshot.
 */
import { describe, it, expect } from 'bun:test';
import {
  detectStagnation,
  detectTriStateDesync,
  detectRepeatLoop,
  STAGNATION_THRESHOLD_MS,
  type StagnationInput,
  type TriStateDesyncInput,
  type RepeatLoopTransition,
} from './incident-signature-detectors';

const NOW = 1_000_000_000_000;

describe('detectStagnation', () => {
  // A stagnant in-progress task: idle beyond the threshold, nothing running,
  // nothing queued, no legitimate wait state. Each test below flips ONE guard.
  const base: StagnationInput = {
    taskStatus: 'in-progress',
    workflowStatus: 'in_progress',
    lastActivityAtMs: NOW - STAGNATION_THRESHOLD_MS - 60_000,
    hasLiveExecution: false,
    hasAnyExecution: false,
    hasActiveQueueItem: false,
    nowMs: NOW,
  };

  it('detects a stale non-terminal task with no execution and no queue item', () => {
    const result = detectStagnation(base);
    expect(result).not.toBeNull();
    expect(result?.staleMs).toBe(STAGNATION_THRESHOLD_MS + 60_000);
  });

  it('detects at exactly the threshold (>= boundary)', () => {
    const result = detectStagnation({
      ...base,
      lastActivityAtMs: NOW - STAGNATION_THRESHOLD_MS,
    });
    expect(result).toEqual({ staleMs: STAGNATION_THRESHOLD_MS });
  });

  it('does NOT detect 1ms under the threshold', () => {
    expect(
      detectStagnation({ ...base, lastActivityAtMs: NOW - STAGNATION_THRESHOLD_MS + 1 }),
    ).toBeNull();
  });

  it.each([
    { name: 'a live execution exists', over: { hasLiveExecution: true } },
    { name: 'an active queue item exists', over: { hasActiveQueueItem: true } },
    {
      name: 'the task awaits a user answer',
      over: { workflowStatus: 'awaiting_question' },
    },
    { name: 'the workflow already completed', over: { workflowStatus: 'completed' } },
    { name: 'the task status is done', over: { taskStatus: 'done' } },
    { name: 'the task status is cancelled', over: { taskStatus: 'cancelled' } },
  ])('does NOT detect when $name', ({ over }) => {
    expect(detectStagnation({ ...base, ...over })).toBeNull();
  });

  it('still detects a blocked task (blocked is not terminal)', () => {
    expect(detectStagnation({ ...base, taskStatus: 'blocked' })).not.toBeNull();
  });

  // 受入(a): a never-started todo backlog item is out of scope no matter how stale.
  it('does NOT detect a pure todo backlog item (draft workflow, no execution ever)', () => {
    expect(
      detectStagnation({
        ...base,
        taskStatus: 'todo',
        workflowStatus: 'draft',
        lastActivityAtMs: NOW - STAGNATION_THRESHOLD_MS - 4 * 60_000, // 34m stale
      }),
    ).toBeNull();
  });

  it('does NOT detect a not-started task with workflowStatus=null (null guard)', () => {
    expect(detectStagnation({ ...base, taskStatus: 'todo', workflowStatus: null })).toBeNull();
  });

  // Each in-flight branch alone re-enables detection.
  it.each([
    { name: 'the workflow ever advanced past draft', over: { workflowStatus: 'research_done' } },
    { name: 'any execution ever existed', over: { hasAnyExecution: true } },
    { name: 'the task status is in-progress', over: { taskStatus: 'in-progress' } },
  ])('still detects when $name (single in-flight branch)', ({ over }) => {
    expect(
      detectStagnation({
        ...base,
        taskStatus: 'todo',
        workflowStatus: 'draft',
        ...over,
      }),
    ).not.toBeNull();
  });

  it('honors a custom thresholdMs override', () => {
    const custom = { ...base, lastActivityAtMs: NOW - 5_000, thresholdMs: 4_000 };
    expect(detectStagnation(custom)).toEqual({ staleMs: 5_000 });
    expect(detectStagnation({ ...custom, thresholdMs: 6_000 })).toBeNull();
  });
});

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
});

describe('detectRepeatLoop', () => {
  const at = (msAgo: number, cause = 'ci_repair', actor = 'system'): RepeatLoopTransition => ({
    cause,
    createdAtMs: NOW - msAgo,
    actor,
  });

  it('detects exactly minCount same-cause transitions inside the window', () => {
    const result = detectRepeatLoop({
      transitions: [at(1_000), at(2_000), at(3_000)],
      nowMs: NOW,
      windowMs: 60 * 60 * 1000,
      minCount: 3,
    });
    expect(result).toEqual({ cause: 'ci_repair', count: 3 });
  });

  it('does NOT detect below minCount', () => {
    expect(
      detectRepeatLoop({
        transitions: [at(1_000), at(2_000)],
        nowMs: NOW,
        windowMs: 60 * 60 * 1000,
        minCount: 3,
      }),
    ).toBeNull();
  });

  it('excludes transitions older than the window (boundary: exactly windowMs is included)', () => {
    const windowMs = 60 * 60 * 1000;
    // Two in-window + one exactly AT the window start (inclusive) → 3 → detect.
    expect(
      detectRepeatLoop({
        transitions: [at(1_000), at(2_000), at(windowMs)],
        nowMs: NOW,
        windowMs,
        minCount: 3,
      }),
    ).toEqual({ cause: 'ci_repair', count: 3 });
    // One 1ms beyond the window start → only 2 counted → no detection.
    expect(
      detectRepeatLoop({
        transitions: [at(1_000), at(2_000), at(windowMs + 1)],
        nowMs: NOW,
        windowMs,
        minCount: 3,
      }),
    ).toBeNull();
  });

  it('picks the cause with the highest in-window count when several qualify', () => {
    const result = detectRepeatLoop({
      transitions: [
        at(1_000, 'verify_repair'),
        at(2_000, 'verify_repair'),
        at(3_000, 'verify_repair'),
        at(4_000, 'verify_repair'),
        at(5_000, 'ci_repair'),
        at(6_000, 'ci_repair'),
        at(7_000, 'ci_repair'),
      ],
      nowMs: NOW,
      minCount: 3,
    });
    expect(result).toEqual({ cause: 'verify_repair', count: 4 });
  });

  it('breaks a count tie deterministically by cause name ascending', () => {
    const result = detectRepeatLoop({
      transitions: [
        at(1_000, 'verify_repair'),
        at(2_000, 'verify_repair'),
        at(3_000, 'verify_repair'),
        at(4_000, 'ci_repair'),
        at(5_000, 'ci_repair'),
        at(6_000, 'ci_repair'),
      ],
      nowMs: NOW,
      minCount: 3,
    });
    expect(result).toEqual({ cause: 'ci_repair', count: 3 });
  });

  // 受入(b): operator manual recovery is intervention, not a loop.
  it('does NOT detect a repeat made solely of actor=user transitions', () => {
    expect(
      detectRepeatLoop({
        transitions: [
          at(1_000, 'manual_status_change', 'user'),
          at(2_000, 'manual_status_change', 'user'),
          at(3_000, 'manual_status_change', 'user'),
        ],
        nowMs: NOW,
        minCount: 3,
      }),
    ).toBeNull();
  });

  it('does NOT detect when user transitions pad a below-threshold system repeat', () => {
    expect(
      detectRepeatLoop({
        transitions: [
          at(1_000, 'ci_repair', 'system'),
          at(2_000, 'ci_repair', 'system'),
          at(3_000, 'ci_repair', 'user'),
        ],
        nowMs: NOW,
        minCount: 3,
      }),
    ).toBeNull();
  });

  it('returns null for an empty transition list', () => {
    expect(detectRepeatLoop({ transitions: [], nowMs: NOW })).toBeNull();
  });
});
