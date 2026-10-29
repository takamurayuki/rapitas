/**
 * incident-signature-detectors.suppression-invariants.test
 *
 * Two invariants that every suppression gate in this module exists to uphold,
 * checked by EXHAUSTIVE ENUMERATION of the detector's input space rather than
 * by hand-picked cases:
 *
 *   P1  a task in a terminal status trips no anomaly detector
 *   P2  a deliberately held task — halted, opted out of auto-run, or manually
 *       withdrawn — trips no anomaly detector
 *
 * Why enumeration. Pattern B accumulated six suppression gates one at a time,
 * each added after a production false positive (#715, #769, #875, #969,
 * #1003), while Pattern A kept only its settle window. An enumeration run on
 * 2026-10-28 found 16 distinct P1 shapes and 32 distinct P2 shapes, all in
 * Pattern A, over 442,368 states — and zero in Pattern B or in
 * detectStagnation's 1,769,472 states, which is what showed the check
 * discriminates rather than flagging everything. Hand-written cases had not
 * found them in the ~18 months the asymmetry existed.
 *
 * NOTE: `expect(fired).toBeGreaterThan(0)` is load-bearing. Without it a
 * change that stops Pattern A ever firing would leave this file green while
 * measuring nothing — the exact failure mode the enumeration exists to catch.
 */
import { describe, it, expect } from 'bun:test';
import { detectTriStateDesync, type TriStateDesyncInput } from './incident-signature-detectors';
import { TERMINAL_TASK_STATUSES } from './incident-signature-unanswered-question';

const NOW = 1_000_000_000_000;
/** Past both the Pattern A settle window and the Pattern B recovery grace. */
const LONG_AGO = NOW - 24 * 60 * 60_000;

/** The Pattern A shape: newest session terminally failed, newest execution still live. */
const patternA = (over: Partial<TriStateDesyncInput> = {}): TriStateDesyncInput => ({
  taskStatus: 'in-progress',
  workflowStatus: 'research_done',
  latestSessionStatus: 'failed',
  latestExecutionStatus: 'running',
  latestSessionUpdatedAtMs: LONG_AGO,
  nowMs: NOW,
  ...over,
});

describe('Pattern A honours the same suppression gates as Pattern B', () => {
  it('fires on the bare shape — the positive control for every case below', () => {
    expect(detectTriStateDesync(patternA())?.kind).toBe('session_failed_execution_active');
  });

  // Driven off the set the implementation reads, so the two cannot drift.
  it.each([...TERMINAL_TASK_STATUSES])('stays silent for a %s task (P1)', (taskStatus) => {
    expect(detectTriStateDesync(patternA({ taskStatus }))).toBeNull();
  });

  // NOTE: 'failed' is NOT in this module's TERMINAL_TASK_STATUSES, so a failed
  // task is still subject to detection. Three other definitions of the same
  // concept — resumable-execution-policy.ts, concern-backlog-service.ts,
  // concern-recurrence-policy.ts — all DO include it. Pinned here rather than
  // changed: widening the set would also silence detectStagnation and
  // detectUnansweredQuestion for failed tasks, which may be the opposite of
  // what their owners want. Found by enumeration 2026-10-28; the decision is
  // tracked as concern #14244, so this test is the pin, not the fix.
  it('still detects a failed task — "failed" is absent from this terminal set', () => {
    expect(TERMINAL_TASK_STATUSES.has('failed')).toBe(false);
    expect(detectTriStateDesync(patternA({ taskStatus: 'failed' }))?.kind).toBe(
      'session_failed_execution_active',
    );
  });

  it.each(['taskHalted', 'autoRunExcluded', 'manuallyWithdrawn'] as const)(
    'stays silent when %s is set (P2)',
    (flag) => {
      expect(detectTriStateDesync(patternA({ [flag]: true }))).toBeNull();
    },
  );
});

describe('exhaustive enumeration of detectTriStateDesync', () => {
  // Equivalence reduction, because the code makes no finer distinction: gates
  // written `if (input.x)` treat false/null/undefined alike, so those collapse
  // to one class; `themeAutoRunEnabled` is read with `=== false`, so for it
  // {true, null, undefined} collapse to "enabled". Timestamps are enumerated
  // as the classes the comparisons distinguish, not as raw numbers.
  const TASK_STATUSES = [
    'todo',
    'in-progress',
    'blocked',
    'done',
    'completed',
    'failed',
    'cancelled',
    'archived',
  ];
  const WORKFLOW_STATUSES = [
    null,
    'draft',
    'research_done',
    'plan_created',
    'plan_approved',
    'in_progress',
    'verify_done',
    'completed',
    'awaiting_question',
  ];
  const SESSION_STATUSES = [null, 'failed', 'cancelled', 'completed'];
  const EXECUTION_STATUSES = [null, 'running', 'pending', 'completed'];
  const FALSY_OR_TRUE: (boolean | null)[] = [null, true];
  const ENABLED_OR_NOT: (boolean | null)[] = [null, false];
  const QUEUE_TRI: (boolean | undefined)[] = [undefined, false, true];
  const AGES = [LONG_AGO, NOW - 1_000];

  // `themeAutoRunEnabled === false` is deliberately absent: pattern-b-grace
  // .test pins "does NOT let a disabled theme auto-run suppress pattern A"
  // (#715), so a paused theme is NOT a hold for Pattern A's purposes. Adding
  // it here would make this enumeration demand the opposite of that test —
  // which is how the first attempt at this change was caught.
  const held = (i: TriStateDesyncInput): boolean =>
    i.taskHalted === true || i.autoRunExcluded === true || i.manuallyWithdrawn === true;

  interface Outcome {
    states: number;
    fired: number;
    p1: TriStateDesyncInput[];
    p2: TriStateDesyncInput[];
  }

  function enumerate(): Outcome {
    const out: Outcome = { states: 0, fired: 0, p1: [], p2: [] };
    for (const taskStatus of TASK_STATUSES)
      for (const workflowStatus of WORKFLOW_STATUSES)
        for (const latestSessionStatus of SESSION_STATUSES)
          for (const latestExecutionStatus of EXECUTION_STATUSES)
            for (const themeAutoRunEnabled of ENABLED_OR_NOT)
              for (const manuallyWithdrawn of FALSY_OR_TRUE)
                for (const themeAutoRunBusyWithOtherTask of FALSY_OR_TRUE)
                  for (const taskHalted of FALSY_OR_TRUE)
                    for (const autoRunExcluded of FALSY_OR_TRUE)
                      for (const hasActiveQueueItem of QUEUE_TRI)
                        for (const latestSessionUpdatedAtMs of AGES)
                          for (const latestTransitionAtMs of AGES) {
                            const input: TriStateDesyncInput = {
                              taskStatus,
                              workflowStatus,
                              latestSessionStatus,
                              latestExecutionStatus,
                              themeAutoRunEnabled,
                              manuallyWithdrawn,
                              themeAutoRunBusyWithOtherTask,
                              taskHalted,
                              autoRunExcluded,
                              hasActiveQueueItem,
                              latestSessionUpdatedAtMs,
                              latestTransitionCause: null,
                              latestTransitionAtMs,
                              nowMs: NOW,
                            };
                            out.states++;
                            if (!detectTriStateDesync(input)) continue;
                            out.fired++;
                            if (TERMINAL_TASK_STATUSES.has(taskStatus) && out.p1.length < 5)
                              out.p1.push(input);
                            if (held(input) && out.p2.length < 5) out.p2.push(input);
                          }
    return out;
  }

  const result = enumerate();

  it('covers the whole reduced input space', () => {
    expect(result.states).toBe(442_368);
  });

  it('still detects something — the enumeration is not vacuous', () => {
    expect(result.fired).toBeGreaterThan(0);
  });

  it('P1: no terminal-status task trips any branch', () => {
    expect(result.p1).toEqual([]);
  });

  it('P2: no deliberately held task trips any branch', () => {
    expect(result.p2).toEqual([]);
  });
});
