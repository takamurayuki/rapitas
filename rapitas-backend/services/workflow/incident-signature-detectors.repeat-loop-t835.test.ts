/**
 * incident-signature-detectors.repeat-loop-t835.test
 *
 * Regression pin for the self-detected incident on task #833 (task #835):
 * replays #833's real transition window against detectRepeatLoop. Three
 * `verify_repair` bounces are what a repair budget of 3 produces when it is
 * spent in full, yet the static REPEAT_LOOP_MIN_COUNT (3) reported them as a
 * loop. The detector now takes the caller-resolved budget (limit + 1), so the
 * same window is a loop only when it actually overruns the budget in force.
 * No mocks, pure snapshot inputs.
 */
import { describe, it, expect } from 'bun:test';
import { detectRepeatLoop, type RepeatLoopTransition } from './incident-signature-detectors';

// The moment the self-incident watcher filed the finding for task #833.
const DETECTED_AT_MS = Date.parse('2026-09-02T04:41:32.593Z');

const t = (iso: string, cause: string, actor: string): RepeatLoopTransition => ({
  cause,
  createdAtMs: Date.parse(iso),
  actor,
  invariantViolation: false,
});

// Task #833's actual transition timeline, verbatim from the task #835 report.
// Only the rows inside the 60-minute window ending at DETECTED_AT_MS matter;
// the earlier rows are kept so the fixture stays a faithful replay.
const TASK_833_WINDOW: RepeatLoopTransition[] = [
  t('2026-09-02T03:48:52.179Z', 'verify_repair', 'system'),
  t('2026-09-02T03:49:03.873Z', 'phase_completed:implementer', 'implementer'),
  t('2026-09-02T03:57:19.430Z', 'file_saved:verify', 'system'),
  t('2026-09-02T04:03:27.786Z', 'verify_repair', 'system'),
  t('2026-09-02T04:06:37.024Z', 'phase_completed:implementer', 'implementer'),
  t('2026-09-02T04:10:07.776Z', 'file_saved:verify', 'system'),
  t('2026-09-02T04:15:09.140Z', 'verify_repair', 'system'),
  t('2026-09-02T04:25:51.802Z', 'stale_execution_recovery_revert', 'system'),
  t('2026-09-02T04:33:04.276Z', 'phase_completed:implementer', 'implementer'),
  t('2026-09-02T04:38:58.693Z', 'file_saved:verify', 'system'),
];

describe('detectRepeatLoop — #833 verify_repair false positive (task 835 repro)', () => {
  // #833's live UserSettings.verifyRepairLimit was not readable from the
  // implementer role, so both possible values are pinned rather than guessed:
  // the detector must agree with whichever budget is actually in force.

  // verifyRepairLimit = 3 (budget spent in full, no overrun) → not a loop.
  it('does NOT flag #833’s window when the repair budget in force is 3', () => {
    expect(
      detectRepeatLoop({
        transitions: TASK_833_WINDOW,
        nowMs: DETECTED_AT_MS,
        taskStatus: 'in-progress',
        verifyRepairMinCount: 4,
      }),
    ).toBeNull();
  });

  // verifyRepairLimit = 2 (default) → the 3rd bounce IS an overrun and must
  // still be reported; the fix narrows the signature, it does not remove it.
  it('still flags #833’s window when the repair budget in force is 2 (overrun)', () => {
    expect(
      detectRepeatLoop({
        transitions: TASK_833_WINDOW,
        nowMs: DETECTED_AT_MS,
        taskStatus: 'in-progress',
        verifyRepairMinCount: 3,
      }),
    ).toEqual({ cause: 'verify_repair', count: 3, via: 'general' });
  });

  // Pre-fix behaviour: with no budget injected the static threshold (3) fires,
  // which is exactly the false positive this task was filed for.
  it('reproduces the pre-fix false positive when no budget is injected', () => {
    expect(
      detectRepeatLoop({
        transitions: TASK_833_WINDOW,
        nowMs: DETECTED_AT_MS,
        taskStatus: 'in-progress',
      }),
    ).toEqual({ cause: 'verify_repair', count: 3, via: 'general' });
  });
});
