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
  detectUnansweredQuestion,
  STAGNATION_THRESHOLD_MS,
  DESYNC_RECOVERY_SETTLE_MS,
  UNANSWERED_QUESTION_THRESHOLD_MS,
  type StagnationInput,
  type TriStateDesyncInput,
  type RepeatLoopTransition,
  type UnansweredQuestionInput,
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

  // #607 completed 12s before the watcher fired on its 3-cycle verify history —
  // detectRepeatLoop must not flag a task that has already reached a terminal
  // status, mirroring detectStagnation's guard.
  it('does NOT detect when taskStatus is terminal, even with a qualifying count (#607 repro)', () => {
    for (const status of ['completed', 'done', 'cancelled', 'archived']) {
      expect(
        detectRepeatLoop({
          transitions: [at(1_000), at(2_000), at(3_000)],
          nowMs: NOW,
          taskStatus: status,
          minCount: 3,
        }),
      ).toBeNull();
    }
  });

  it('still detects when taskStatus is non-terminal', () => {
    const result = detectRepeatLoop({
      transitions: [at(1_000), at(2_000), at(3_000)],
      nowMs: NOW,
      taskStatus: 'in-progress',
      minCount: 3,
    });
    expect(result).toEqual({ cause: 'ci_repair', count: 3 });
  });

  it('still detects when taskStatus is omitted (backward compatibility)', () => {
    const result = detectRepeatLoop({
      transitions: [at(1_000), at(2_000), at(3_000)],
      nowMs: NOW,
      minCount: 3,
    });
    expect(result).toEqual({ cause: 'ci_repair', count: 3 });
  });

  // #607 repro (task 614): a healthy repair cycle (initial implement + 2
  // verify_repair bounces, the default budget) fires
  // phase_completed:implementer exactly 3 times — the same as
  // REPEAT_LOOP_MIN_COUNT's default — and was misreported as a loop.
  it('does NOT detect phase_completed:implementer at the normal repair-budget count (#607 repro)', () => {
    expect(
      detectRepeatLoop({
        transitions: [
          at(1_000, 'phase_completed:implementer'),
          at(2_000, 'verify_repair'),
          at(3_000, 'phase_completed:implementer'),
          at(4_000, 'verify_repair'),
          at(5_000, 'phase_completed:implementer'),
        ],
        nowMs: NOW,
        minCount: 3,
      }),
    ).toBeNull();
  });

  it('still detects a non-phase_completed cause padded with phase_completed noise', () => {
    const result = detectRepeatLoop({
      transitions: [
        at(1_000, 'phase_completed:implementer'),
        at(2_000, 'phase_completed:implementer'),
        at(3_000, 'phase_completed:implementer'),
        at(4_000, 'verify_repair'),
        at(5_000, 'verify_repair'),
        at(6_000, 'verify_repair'),
      ],
      nowMs: NOW,
      minCount: 3,
    });
    expect(result).toEqual({ cause: 'verify_repair', count: 3 });
  });

  // The phase_completed exclusion is scoped to the known-healthy repair-cycle
  // pattern: without a verify_repair/ci_repair bounce anywhere in the window,
  // repeated phase_completed:* is a genuinely different anomaly (e.g. a phase
  // handing off to itself with no verify/ci signal at all) and must still be
  // detected.
  it('still detects phase_completed:implementer when NO repair-bounce cause is present', () => {
    const result = detectRepeatLoop({
      transitions: [
        at(1_000, 'phase_completed:implementer'),
        at(2_000, 'phase_completed:implementer'),
        at(3_000, 'phase_completed:implementer'),
      ],
      nowMs: NOW,
      minCount: 3,
    });
    expect(result).toEqual({ cause: 'phase_completed:implementer', count: 3 });
  });

  // The forgiveness budget is bounded by the bounces observed *up to that
  // point*: a single verify_repair bounce can only forgive 2
  // phase_completed:implementer firings (1 initial + 1 re-implement after the
  // bounce). The remaining 3 firings after the bounce have no further bounce
  // to explain them and are a genuine anomaly the detector must still catch.
  it('still detects phase_completed:implementer when count exceeds what the observed bounces explain', () => {
    const result = detectRepeatLoop({
      transitions: [
        at(1_000, 'phase_completed:implementer'),
        at(2_000, 'verify_repair'),
        at(3_000, 'phase_completed:implementer'),
        at(4_000, 'phase_completed:implementer'),
        at(5_000, 'phase_completed:implementer'),
        at(6_000, 'phase_completed:implementer'),
      ],
      nowMs: NOW,
      minCount: 3,
    });
    expect(result).toEqual({ cause: 'phase_completed:implementer', count: 3 });
  });

  // Two bounces (one verify_repair, one ci_repair), each preceding the
  // phase_completed:implementer firing it re-authorizes, sum to a budget of 3
  // (1 initial + 2 bounces) — exactly 3 firings stays within the healthy
  // repair-cycle explanation and must not be flagged.
  it('sums verify_repair and ci_repair bounces toward the healthy-cycle budget', () => {
    const result = detectRepeatLoop({
      transitions: [
        at(1_000, 'phase_completed:implementer'),
        at(2_000, 'verify_repair'),
        at(3_000, 'phase_completed:implementer'),
        at(4_000, 'ci_repair'),
        at(5_000, 'phase_completed:implementer'),
      ],
      nowMs: NOW,
      minCount: 3,
    });
    expect(result).toBeNull();
  });

  // Closes the gap flagged in review: bounceTotal alone (summed across
  // verify_repair + ci_repair, order-independent) could put 5
  // phase_completed:implementer firings within a budget of 4 + 1 = 5 even
  // when all 5 firings happened *before* any bounce — bounces that occur
  // later cannot causally explain churn that already happened. Only a bounce
  // chronologically preceding a firing may forgive it, so here only the very
  // first firing (the always-free initial pass) is forgiven and the other 4
  // are counted as a genuine anomaly, despite 4 bounces appearing later in
  // the same window.
  it('does not let bounces forgive phase_completed churn that happened before them', () => {
    // at(msAgo, ...) — larger msAgo sorts earlier, so this array is already
    // in chronological (oldest-first) order: 5 phase_completed firings, THEN
    // the 4 bounces.
    const result = detectRepeatLoop({
      transitions: [
        at(9_000, 'phase_completed:implementer'),
        at(8_000, 'phase_completed:implementer'),
        at(7_000, 'phase_completed:implementer'),
        at(6_000, 'phase_completed:implementer'),
        at(5_000, 'phase_completed:implementer'),
        at(4_000, 'verify_repair'),
        at(3_000, 'verify_repair'),
        at(2_000, 'ci_repair'),
        at(1_000, 'ci_repair'),
      ],
      nowMs: NOW,
      minCount: 3,
    });
    expect(result).toEqual({ cause: 'phase_completed:implementer', count: 4 });
  });

  // Task 673/681: independent low-threshold path for invariantViolation-flagged
  // transitions, bypassing forgivenessBudget entirely.
  const atInv = (
    msAgo: number,
    cause: string,
    actor = 'system',
    invariantViolation = false,
  ): RepeatLoopTransition => ({ cause, createdAtMs: NOW - msAgo, actor, invariantViolation });

  it('detects same-cause invariantViolation transitions below the general minCount (task 673 repro)', () => {
    const result = detectRepeatLoop({
      transitions: [
        atInv(69_000, 'verify_pr_not_created', 'system', true),
        atInv(9_000, 'verify_pr_not_created', 'verifier', true),
      ],
      nowMs: NOW,
      minCount: 3,
      invariantMinCount: 2,
    });
    expect(result).toEqual({ cause: 'verify_pr_not_created', count: 2 });
  });

  it('does NOT detect the same 2-count pattern when invariantViolation is false (existing behavior preserved)', () => {
    const result = detectRepeatLoop({
      transitions: [
        atInv(69_000, 'verify_pr_not_created', 'system', false),
        atInv(9_000, 'verify_pr_not_created', 'verifier', false),
      ],
      nowMs: NOW,
      minCount: 3,
      invariantMinCount: 2,
    });
    expect(result).toBeNull();
  });

  it('task 673 replay: 2 invariantViolation verify_pr_not_created transitions 70s apart (actor system -> verifier) is detected', () => {
    // 2026-08-26T22:59:53.555Z (actor: system) and 23:00:53.915Z (actor: verifier)
    const t1 = Date.parse('2026-08-26T22:59:53.555Z');
    const t2 = Date.parse('2026-08-26T23:00:53.915Z');
    const now = t2 + 1_000;
    const result = detectRepeatLoop({
      transitions: [
        {
          cause: 'verify_pr_not_created',
          createdAtMs: t1,
          actor: 'system',
          invariantViolation: true,
        },
        {
          cause: 'verify_pr_not_created',
          createdAtMs: t2,
          actor: 'verifier',
          invariantViolation: true,
        },
      ],
      nowMs: now,
    });
    expect(result).not.toBeNull();
    expect(result).toEqual({ cause: 'verify_pr_not_created', count: 2 });
  });
});

describe('detectUnansweredQuestion', () => {
  // Reproduction fixture from the incident that motivated this detector:
  // tasks #578/#579 both entered awaiting_question at 2026-08-13T13:48:35Z
  // (cause=intake_question) and sat unanswered until found on 2026-08-17.
  const RAISED_578 = Date.parse('2026-08-13T13:48:35.000Z');
  const FOUND_578 = Date.parse('2026-08-17T13:48:35.000Z'); // 4 days later

  const base: UnansweredQuestionInput = {
    workflowStatus: 'awaiting_question',
    questionRaisedAtMs: RAISED_578,
    hasAnsweredQuestion: false,
    nowMs: FOUND_578,
  };

  it('detects the #578/#579 shape: 4 days unanswered', () => {
    const result = detectUnansweredQuestion(base);
    expect(result).toEqual({ staleMs: FOUND_578 - RAISED_578 });
    expect(result!.staleMs).toBeGreaterThanOrEqual(UNANSWERED_QUESTION_THRESHOLD_MS);
  });

  it('detects at exactly the threshold (>= boundary)', () => {
    expect(
      detectUnansweredQuestion({
        ...base,
        nowMs: RAISED_578 + UNANSWERED_QUESTION_THRESHOLD_MS,
      }),
    ).toEqual({ staleMs: UNANSWERED_QUESTION_THRESHOLD_MS });
  });

  it('does NOT detect 1ms under the threshold', () => {
    expect(
      detectUnansweredQuestion({
        ...base,
        nowMs: RAISED_578 + UNANSWERED_QUESTION_THRESHOLD_MS - 1,
      }),
    ).toBeNull();
  });

  // 非発火正常系: a freshly raised question is a legitimate wait, not an incident.
  it('does NOT detect a question raised moments ago', () => {
    expect(detectUnansweredQuestion({ ...base, nowMs: RAISED_578 + 60_000 })).toBeNull();
  });

  it.each(['draft', 'in_progress', 'completed', null])(
    'does NOT detect when workflowStatus=%p (not awaiting a question)',
    (wf) => {
      expect(detectUnansweredQuestion({ ...base, workflowStatus: wf })).toBeNull();
    },
  );

  // 受入基準4: an answered task must never re-notify, however stale its status.
  it('does NOT detect when the question was already answered', () => {
    expect(detectUnansweredQuestion({ ...base, hasAnsweredQuestion: true })).toBeNull();
  });

  it('does NOT detect when no awaiting_question transition exists (unknown wait start)', () => {
    expect(detectUnansweredQuestion({ ...base, questionRaisedAtMs: null })).toBeNull();
  });

  it('honors a custom thresholdMs override', () => {
    const custom = { ...base, nowMs: RAISED_578 + 5_000, thresholdMs: 4_000 };
    expect(detectUnansweredQuestion(custom)).toEqual({ staleMs: 5_000 });
    expect(detectUnansweredQuestion({ ...custom, thresholdMs: 6_000 })).toBeNull();
  });
});
