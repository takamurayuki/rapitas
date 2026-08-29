/**
 * incident-signature-detectors.repeat-loop-t673.test
 *
 * Regression pin for task #681 (observed on task #673): replays task #673's
 * real transition window against detectRepeatLoop with production defaults.
 * Under the pre-fix defaults (REPEAT_LOOP_MIN_COUNT=3, no invariant-specific
 * path) the 2 `verify_pr_not_created` invariantViolation transitions 70s
 * apart went undetected; the invariant-specific low-threshold path (task 681)
 * must catch them. Split out per the repeat-loop-t616 naming convention;
 * no mocks, pure snapshot inputs.
 */
import { describe, it, expect } from 'bun:test';
import { detectRepeatLoop, type RepeatLoopTransition } from './incident-signature-detectors';

// The moment the retrospective filed the anomaly-cause finding for task #673.
const DETECTED_AT_MS = Date.parse('2026-08-26T23:51:13.131Z');

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

// Task #673's actual transition timeline (verbatim from the task description).
const TASK_673_WINDOW: RepeatLoopTransition[] = [
  t('2026-08-26T22:08:37.182Z', 'intake_enriched', 'system'),
  t('2026-08-26T22:13:04.400Z', 'phase_completed:researcher', 'researcher'),
  t('2026-08-26T22:21:55.337Z', 'phase_completed:planner', 'planner'),
  t('2026-08-26T22:21:55.353Z', 'auto_approve_plan', 'system'),
  t('2026-08-26T22:48:51.913Z', 'phase_completed:implementer', 'implementer'),
  t('2026-08-26T22:55:16.432Z', 'file_saved:verify', 'system'),
  t('2026-08-26T22:59:53.555Z', 'verify_pr_not_created', 'system', true),
  t('2026-08-26T23:00:53.915Z', 'verify_pr_not_created', 'verifier', true),
  t('2026-08-26T23:04:35.031Z', 'blocked_auto_retry', 'system'),
  t('2026-08-26T23:36:39.159Z', 'artifact_reuse_fastforward', 'system'),
  t('2026-08-26T23:40:56.884Z', 'phase_completed:implementer', 'implementer'),
  t('2026-08-26T23:46:20.243Z', 'file_saved:verify', 'system'),
  t('2026-08-26T23:49:33.286Z', 'verify_passed', 'system'),
];

describe('detectRepeatLoop — task #673 invariantViolation repeat (task #681 fix)', () => {
  // taskStatus is passed as non-terminal so the assertion exercises the
  // repeat-loop window logic itself, matching the repeat-loop-t616 pattern
  // (the terminal-status short-circuit is covered separately).
  it('detects the 2x verify_pr_not_created invariantViolation pair with production defaults', () => {
    expect(
      detectRepeatLoop({
        transitions: TASK_673_WINDOW,
        nowMs: DETECTED_AT_MS,
        taskStatus: 'in-progress',
      }),
    ).toEqual({ cause: 'verify_pr_not_created', count: 2, via: 'invariant' });
  });

  // Contrast case: without the invariantViolation flags the same 2-count
  // cause never reaches the general REPEAT_LOOP_MIN_COUNT (3) — proving the
  // detection above is earned by the invariant-specific path, not padding.
  it('does NOT detect the same window when invariantViolation flags are stripped (pre-fix behavior)', () => {
    expect(
      detectRepeatLoop({
        transitions: TASK_673_WINDOW.map((tr) => ({ ...tr, invariantViolation: false })),
        nowMs: DETECTED_AT_MS,
        taskStatus: 'in-progress',
      }),
    ).toBeNull();
  });
});
