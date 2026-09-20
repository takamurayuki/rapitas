/**
 * incident-signature-detectors.repeat-loop-t970.test
 *
 * Regression pin for the self-detected incident on task 970 (task 976):
 * replays a synthesized window matching #970's reported 3x
 * `verify_review_admitted` occurrence (production defaults require count >=
 * REPEAT_LOOP_MIN_COUNT=3 to trip; the 10-entry timeline in the task
 * description only showed 2 of the 3) against detectRepeatLoop. Split from
 * incident-signature-detectors.test.ts (over the 500-line limit) per the
 * test-suite splitting policy; no mocks, pure snapshot inputs.
 */
import { describe, it, expect } from 'bun:test';
import { detectRepeatLoop, type RepeatLoopTransition } from './incident-signature-detectors';

// The moment the pre-fix backend filed the self-incident on task #970.
const DETECTED_AT_MS = Date.parse('2026-09-17T21:09:59.002Z');

const t = (iso: string, cause: string, actor: string): RepeatLoopTransition => ({
  cause,
  createdAtMs: Date.parse(iso),
  actor,
});

// A healthy self-repair cycle — 3 rounds of implement -> verify save
// (which also records verify_review_admitted per requirement-replan-commit's
// advanceReviewedVerify) -> verify_repair bounce, all inside the 60m default
// window at DETECTED_AT_MS. Extends #970's actual (truncated to 10 entries)
// timeline with one more round to reach the 3x verify_review_admitted count
// that the self-detected incident reported.
const TASK_970_WINDOW: RepeatLoopTransition[] = [
  t('2026-09-17T20:48:51.969Z', 'file_saved:verify', 'system'),
  t('2026-09-17T20:49:02.878Z', 'verify_repair', 'system'),
  t('2026-09-17T20:53:13.642Z', 'phase_completed:implementer', 'implementer'),
  t('2026-09-17T20:58:27.955Z', 'verify_review_admitted', 'system'),
  t('2026-09-17T20:58:27.964Z', 'file_saved:verify', 'system'),
  t('2026-09-17T20:58:37.109Z', 'verify_repair', 'system'),
  t('2026-09-17T21:03:09.428Z', 'phase_completed:implementer', 'implementer'),
  t('2026-09-17T21:06:53.826Z', 'verify_review_admitted', 'system'),
  t('2026-09-17T21:06:53.832Z', 'file_saved:verify', 'system'),
  t('2026-09-17T21:07:04.682Z', 'verify_repair', 'system'),
  t('2026-09-17T21:09:30.000Z', 'phase_completed:implementer', 'implementer'),
  t('2026-09-17T21:09:45.000Z', 'verify_review_admitted', 'system'),
  t('2026-09-17T21:09:45.010Z', 'file_saved:verify', 'system'),
];

describe('detectRepeatLoop — #970 false positive (task 976 repro)', () => {
  // taskStatus is a non-terminal placeholder — the null must come from the
  // forgiveness budgets, not the terminal-status guard.
  it('does NOT flag task #970’s real window with production defaults', () => {
    expect(
      detectRepeatLoop({
        transitions: TASK_970_WINDOW,
        nowMs: DETECTED_AT_MS,
        taskStatus: 'plan_approved',
        // self-incident-watcher.ts resolves this per-pass as
        // max(REPEAT_LOOP_MIN_COUNT, max(verifyRepairLimit, DEFAULT_MAX_CI_REPAIRS) + 1)
        // so that exhausting the repair budget is not itself a loop (task 837)
        // — here it must exceed the window's 3 verify_repair bounces.
        repairBounceMinCount: 4,
      }),
    ).toBeNull();
  });

  // Contrast case: strip the verify_repair bounces that causally explain the
  // re-implements and re-saves. With zero bounces none of the three causes
  // is forgiven and the 4x file_saved:verify (also exceeding
  // verify_review_admitted's 3x and phase_completed:implementer's 3x) MUST
  // still be detected — proving the null above is earned by the amnesty
  // budget, not by window/actor filtering swallowing the firings.
  it('still flags a repeat when the explaining verify_repair bounces are absent', () => {
    expect(
      detectRepeatLoop({
        transitions: TASK_970_WINDOW.filter((tr) => tr.cause !== 'verify_repair'),
        nowMs: DETECTED_AT_MS,
        taskStatus: 'plan_approved',
      }),
    ).toEqual({ cause: 'file_saved:verify', count: 4, via: 'general' });
  });
});
