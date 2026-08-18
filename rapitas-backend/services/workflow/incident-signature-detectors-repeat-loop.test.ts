/**
 * incident-signature-detectors-repeat-loop.test
 *
 * Boundary tests for detectRepeatLoop: threshold detection, window/actor
 * guards, and the two independent forgiveness budgets that keep a healthy
 * repair cycle (phase_completed:* firings and file_saved:verify firings, each
 * re-authorized by a preceding verify_repair/ci_repair bounce) from being
 * misreported as a loop (#607, #641).
 * No DB, no mocks — every input is a plain snapshot.
 */
import { describe, it, expect } from 'bun:test';
import { detectRepeatLoop, type RepeatLoopTransition } from './incident-signature-detectors';

const NOW = 1_000_000_000_000;

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

  // --- file_saved:verify forgiveness budget (#643 / #641) -------------------
  // The self-incident watcher misreported #641 as a repeat loop: a healthy
  // 2-round verify_repair self-repair cycle structurally emits 3
  // file_saved:verify transitions (one per verify save). file_saved:verify now
  // has its OWN independent forgiveness budget, symmetric to phase_completed's.

  // #641 repro: the real 8-transition timeline (2 phase_completed:implementer,
  // 3 file_saved:verify, 2 verify_repair bounces, 1 manual_status_change_blocked)
  // must resolve to null — verify_repair peaks at 2 (< minCount) and every
  // file_saved:verify is explained by the bounce that precedes it.
  it('reproduces #641: a healthy 2-round verify_repair cycle no longer flags file_saved:verify as a loop', () => {
    const result = detectRepeatLoop({
      transitions: [
        at(2_500_000, 'phase_completed:implementer'),
        at(2_070_000, 'file_saved:verify'),
        at(1_938_000, 'verify_repair'),
        at(1_894_000, 'manual_status_change_blocked'),
        at(1_877_000, 'file_saved:verify'),
        at(1_711_000, 'verify_repair'),
        at(309_000, 'phase_completed:implementer'),
        at(51_000, 'file_saved:verify'),
      ],
      nowMs: NOW,
      minCount: 3,
    });
    expect(result).toBeNull();
  });

  // Mirror of the phase_completed "no bounce → never forgiven" contract: a
  // repetition of file_saved:verify with zero bounces anywhere in the window
  // is a genuine anomaly and must still be detected.
  it('still detects file_saved:verify with zero bounces in the window', () => {
    const result = detectRepeatLoop({
      transitions: [
        at(1_000, 'file_saved:verify'),
        at(2_000, 'file_saved:verify'),
        at(3_000, 'file_saved:verify'),
      ],
      nowMs: NOW,
      minCount: 3,
    });
    expect(result).toEqual({ cause: 'file_saved:verify', count: 3 });
  });

  // Symmetric to 'does not let bounces forgive phase_completed churn that
  // happened before them': 5 file_saved:verify firings precede a single
  // bounce. Only the always-free initial pass is forgiven; the other 4 are
  // counted because the later bounce cannot causally explain earlier churn.
  it('does not let a bounce forgive file_saved:verify churn that happened before it', () => {
    const result = detectRepeatLoop({
      transitions: [
        at(6_000, 'file_saved:verify'),
        at(5_000, 'file_saved:verify'),
        at(4_000, 'file_saved:verify'),
        at(3_000, 'file_saved:verify'),
        at(2_000, 'file_saved:verify'),
        at(1_000, 'verify_repair'),
      ],
      nowMs: NOW,
      minCount: 3,
    });
    expect(result).toEqual({ cause: 'file_saved:verify', count: 4 });
  });

  // Budget boundary with a single bounce: precharge 1 + 1 from the bounce = 2
  // file_saved:verify firings forgiven. Exactly two firings around one bounce
  // stay below threshold; any firing beyond the 2-budget is counted.
  it('forgives up to 2 file_saved:verify with a single bounce, then counts the rest', () => {
    // Two forgiven → below threshold → null.
    expect(
      detectRepeatLoop({
        transitions: [
          at(3_000, 'file_saved:verify'),
          at(2_000, 'verify_repair'),
          at(1_000, 'file_saved:verify'),
        ],
        nowMs: NOW,
        minCount: 3,
      }),
    ).toBeNull();

    // Same single bounce, but 4 file_saved:verify firings: 2 are forgiven and
    // the other 2 exceed the budget → counted (minCount lowered to 2 to assert
    // on the boundary directly).
    expect(
      detectRepeatLoop({
        transitions: [
          at(5_000, 'file_saved:verify'),
          at(4_000, 'verify_repair'),
          at(3_000, 'file_saved:verify'),
          at(2_000, 'file_saved:verify'),
          at(1_000, 'file_saved:verify'),
        ],
        nowMs: NOW,
        minCount: 2,
      }),
    ).toEqual({ cause: 'file_saved:verify', count: 2 });
  });

  // The two budgets are independent: a single bounce grants each cause its own
  // budget of 2, drawn only by that cause. With 4 phase_completed:implementer
  // (2 forgiven, 2 counted) and 3 file_saved:verify (2 forgiven, 1 counted),
  // phase_completed wins at count 2. A SHARED budget would instead forgive only
  // 2 of the 7 firings total and surface file_saved:verify at count 3 — so this
  // exact expectation fails unless the budgets are kept separate.
  it('keeps phase_completed and file_saved:verify budgets independent', () => {
    const result = detectRepeatLoop({
      transitions: [
        at(8_000, 'verify_repair'),
        at(7_000, 'phase_completed:implementer'),
        at(6_000, 'phase_completed:implementer'),
        at(5_000, 'phase_completed:implementer'),
        at(4_000, 'phase_completed:implementer'),
        at(3_000, 'file_saved:verify'),
        at(2_000, 'file_saved:verify'),
        at(1_000, 'file_saved:verify'),
      ],
      nowMs: NOW,
      minCount: 2,
    });
    expect(result).toEqual({ cause: 'phase_completed:implementer', count: 2 });
  });
});
