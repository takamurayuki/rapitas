/**
 * incident-signature-detectors.repeat-loop-t708.test
 *
 * Regression pin for the self-detected incident on task 674 (task 708):
 * replays #674's real transition window against detectRepeatLoop with
 * production defaults. Split from incident-signature-detectors.test.ts (over
 * the 500-line limit) per the test-suite splitting policy; no mocks, pure
 * snapshot inputs.
 */
import { describe, it, expect } from 'bun:test';
import { detectRepeatLoop, type RepeatLoopTransition } from './incident-signature-detectors';

// The moment the pre-fix backend filed the self-incident on task #674.
const DETECTED_AT_MS = Date.parse('2026-08-27T19:13:12.321Z');

const t = (iso: string, cause: string, actor: string): RepeatLoopTransition => ({
  cause,
  createdAtMs: Date.parse(iso),
  actor,
});

// Task #674's actual transition timeline (all inside the 60m default window
// at DETECTED_AT_MS): a healthy self-repair cycle — 1 initial implement +
// 1 initial verify save + 2 verify_repair bounces, each followed by a
// re-implement and a re-save (the default repair budget of 2).
const TASK_674_WINDOW: RepeatLoopTransition[] = [
  t('2026-08-27T18:56:39.592Z', 'phase_completed:implementer', 'implementer'),
  t('2026-08-27T18:59:08.800Z', 'file_saved:verify', 'system'),
  t('2026-08-27T19:01:15.547Z', 'verify_repair', 'system'),
  t('2026-08-27T19:03:22.424Z', 'phase_completed:implementer', 'implementer'),
  t('2026-08-27T19:04:14.764Z', 'file_saved:verify', 'system'),
  t('2026-08-27T19:06:20.107Z', 'verify_repair', 'system'),
  t('2026-08-27T19:11:14.933Z', 'phase_completed:implementer', 'implementer'),
  t('2026-08-27T19:12:13.403Z', 'file_saved:verify', 'system'),
];

describe('detectRepeatLoop — #674 false positive (task 708 repro)', () => {
  // taskStatus is a non-terminal placeholder — the null must come from the
  // forgiveness budgets, not the terminal-status guard.
  it('does NOT flag task #674’s real window with production defaults', () => {
    expect(
      detectRepeatLoop({
        transitions: TASK_674_WINDOW,
        nowMs: DETECTED_AT_MS,
        taskStatus: 'in-progress',
      }),
    ).toBeNull();
  });

  // Contrast case: strip the verify_repair bounces that causally explain the
  // re-implements and re-saves. With zero bounces neither cause is forgiven
  // and the 3 file_saved:verify firings MUST still be detected — proving the
  // null above is earned by the amnesty budget, not by window/actor
  // filtering swallowing the firings.
  it('still flags file_saved:verify in the same window when the explaining bounces are absent', () => {
    expect(
      detectRepeatLoop({
        transitions: TASK_674_WINDOW.filter((tr) => tr.cause !== 'verify_repair'),
        nowMs: DETECTED_AT_MS,
        taskStatus: 'in-progress',
      }),
    ).toEqual({ cause: 'file_saved:verify', count: 3 });
  });
});
