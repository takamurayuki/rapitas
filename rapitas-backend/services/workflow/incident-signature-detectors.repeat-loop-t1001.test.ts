/**
 * incident-signature-detectors.repeat-loop-t1001.test
 *
 * Regression pin for the self-detected incident on task 1001: repeated
 * `verify_awaiting_required_merge` holds (a legitimate merge wait) were reported as a
 * repeat loop. Replays #995's real 03:06-03:28 timeline. Pure inputs, no mocks.
 */
import { describe, it, expect } from 'bun:test';
import { detectRepeatLoop, type RepeatLoopTransition } from './incident-signature-detectors';

const DETECTED_AT_MS = Date.parse('2026-09-20T03:34:14.033Z');

const t = (iso: string, cause: string, actor: string): RepeatLoopTransition => ({
  cause,
  createdAtMs: Date.parse(iso),
  actor,
});

const HOLD = 'verify_awaiting_required_merge';

const TASK_995_WINDOW: RepeatLoopTransition[] = [
  t('2026-09-20T03:06:28.565Z', 'verify_pr_not_created', 'auto_verifier'),
  t('2026-09-20T03:06:32.208Z', 'verify_passed_awaiting_ci', 'system'),
  t('2026-09-20T03:09:56.270Z', HOLD, 'system'),
  t('2026-09-20T03:10:09.107Z', 'ci_repair', 'system'),
  t('2026-09-20T03:21:09.568Z', 'phase_completed:implementer', 'implementer'),
  t('2026-09-20T03:23:17.578Z', 'verify_review_admitted', 'system'),
  t('2026-09-20T03:23:17.585Z', 'file_saved:verify', 'system'),
  t('2026-09-20T03:24:07.905Z', 'auto_merge_conflict_filed', 'system'),
  t('2026-09-20T03:25:18.516Z', HOLD, 'auto_verifier'),
  t('2026-09-20T03:28:57.345Z', HOLD, 'system'),
];

describe('detectRepeatLoop — task 1001 (verify_awaiting_required_merge)', () => {
  it('does not report repeated merge holds as a loop', () => {
    expect(detectRepeatLoop({ transitions: TASK_995_WINDOW, nowMs: DETECTED_AT_MS })).toBeNull();
  });

  it('still reports another cause repeated 3x alongside the holds', () => {
    const mixed = [
      ...TASK_995_WINDOW,
      t('2026-09-20T03:30:00.000Z', 'some_other_cause', 'system'),
      t('2026-09-20T03:31:00.000Z', 'some_other_cause', 'system'),
      t('2026-09-20T03:32:00.000Z', 'some_other_cause', 'system'),
    ];
    expect(detectRepeatLoop({ transitions: mixed, nowMs: DETECTED_AT_MS })).toMatchObject({
      cause: 'some_other_cause',
      count: 3,
    });
  });
});
