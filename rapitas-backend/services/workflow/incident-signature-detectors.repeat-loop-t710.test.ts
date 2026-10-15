/**
 * incident-signature-detectors.repeat-loop-t710.test
 *
 * Regression pin for the self-detected incident on task #674 (task #710):
 * replays #674's real transition window against detectRepeatLoop with
 * production defaults, in both its pre-fix (as-observed, duplicated) and
 * post-fix (deduplicated) shapes. The duplicate `adversarial_review_failed`
 * row at 16:38:41.951Z was recorded 43ms after `verify_repair_non_convergence`
 * for the SAME non-convergence cutoff — a double-record bug fixed upstream
 * (task #704/#705's `wasNonConvergenceCutoffJustRecorded()` /
 * `cutoffRecorded`, both present at HEAD — see
 * routes/workflow/handlers/file-save/status-transition.ts and
 * verify-adversarial-review.ts). No mocks, pure snapshot inputs.
 */
import { describe, it, expect } from 'bun:test';
import { detectRepeatLoop, type RepeatLoopTransition } from './incident-signature-detectors';

// The moment the self-incident watcher filed the false-positive finding for task #674.
const DETECTED_AT_MS = Date.parse('2026-08-27T16:58:11.048Z');

const t = (
  iso: string,
  cause: string,
  actor: string,
  invariantViolation = false,
): RepeatLoopTransition => ({
  cause,
  createdAtMs: Date.parse(iso),
  actor,
  invariantViolation,
});

// Task #674's actual transition timeline (verbatim from the task #710 bug
// report) — the PRE-FIX shape, including the duplicate adversarial_review_failed
// row that the double-record bug produced.
const TASK_674_WINDOW_PRE_FIX: RepeatLoopTransition[] = [
  t('2026-08-27T15:58:27.159Z', 'adversarial_review_failed', 'system', true),
  t('2026-08-27T16:25:46.614Z', 'phase_completed:implementer', 'implementer'),
  t('2026-08-27T16:28:14.676Z', 'file_saved:verify', 'system'),
  t('2026-08-27T16:30:20.632Z', 'verify_repair', 'system'),
  t('2026-08-27T16:32:31.856Z', 'phase_completed:implementer', 'implementer'),
  t('2026-08-27T16:36:36.360Z', 'file_saved:verify', 'system'),
  t('2026-08-27T16:38:41.908Z', 'verify_repair_non_convergence', 'system', true),
  // Duplicate: recorded 43ms after the row above, for the SAME cutoff.
  t('2026-08-27T16:38:41.951Z', 'adversarial_review_failed', 'system', true),
];

// Same window with the double-record bug fixed: the caller (status-transition.ts /
// verify-adversarial-review.ts) skips its own recordTransition once
// wasNonConvergenceCutoffJustRecorded()/cutoffRecorded confirms the cutoff
// already recorded verify_repair_non_convergence — so the duplicate row above
// is never written.
const TASK_674_WINDOW_POST_FIX: RepeatLoopTransition[] = TASK_674_WINDOW_PRE_FIX.filter(
  (tr) => tr.createdAtMs !== Date.parse('2026-08-27T16:38:41.951Z'),
);

describe('detectRepeatLoop — #674 adversarial_review_failed false positive (task 710 repro)', () => {
  // Contrast case: the pre-fix (as-observed) window DOES trip the low
  // invariant threshold (2) — proving the false positive was real and the
  // detector itself was working correctly off of corrupted (duplicated) input.
  it('flags adversarial_review_failed on the pre-fix (duplicated) window', () => {
    expect(
      detectRepeatLoop({
        transitions: TASK_674_WINDOW_PRE_FIX,
        nowMs: DETECTED_AT_MS,
        taskStatus: 'in-progress',
      }),
    ).toEqual({ cause: 'adversarial_review_failed', count: 2, via: 'invariant' });
  });

  // With the double-record bug fixed, the same real-world window (minus the
  // duplicate row the fix prevents from ever being written) no longer trips
  // any repeat-loop signature — resolving task #710's acceptance criteria
  // (adversarial_review_failed does not recur within 60 minutes; no
  // verify_repair_non_convergence-triggered false positive).
  it('does NOT flag task #674’s real window once the duplicate row is not recorded (post-fix)', () => {
    expect(
      detectRepeatLoop({
        transitions: TASK_674_WINDOW_POST_FIX,
        nowMs: DETECTED_AT_MS,
        taskStatus: 'in-progress',
      }),
    ).toBeNull();
  });
});
