/**
 * incident-signature-detectors.repeat-loop-t616.test
 *
 * Regression pin for concern #621 (task 621): replays task #616's real
 * transition window against detectRepeatLoop with production defaults.
 * Split from incident-signature-detectors.test.ts (over the 500-line limit)
 * per the test-suite splitting policy; no mocks, pure snapshot inputs.
 */
import { describe, it, expect } from 'bun:test';
import { detectRepeatLoop, type RepeatLoopTransition } from './incident-signature-detectors';

// The moment the pre-fix (pre-241a8955) backend filed concern #621.
const DETECTED_AT_MS = Date.parse('2026-08-17T05:28:10.332Z');

const t = (iso: string, cause: string, actor: string): RepeatLoopTransition => ({
  cause,
  createdAtMs: Date.parse(iso),
  actor,
});

// Task #616's actual transition timeline (all inside the 60m default window
// at DETECTED_AT_MS): a healthy self-repair cycle — 1 initial implement +
// 2 verify_repair bounces (the default repair budget) + 2 re-implements.
const TASK_616_WINDOW: RepeatLoopTransition[] = [
  t('2026-08-17T04:31:21.748Z', 'intake_question', 'system'),
  t('2026-08-17T04:43:10.072Z', 'blocked_evidence_done', 'system'),
  t('2026-08-17T04:53:16.658Z', 'auto_merge_conflict_filed', 'system'),
  t('2026-08-17T05:06:51.865Z', 'intake_enriched', 'system'),
  t('2026-08-17T05:12:01.023Z', 'phase_completed:researcher', 'researcher'),
  t('2026-08-17T05:15:36.898Z', 'phase_completed:implementer', 'implementer'),
  t('2026-08-17T05:19:23.785Z', 'verify_repair', 'system'),
  t('2026-08-17T05:21:55.705Z', 'phase_completed:implementer', 'implementer'),
  t('2026-08-17T05:24:15.131Z', 'verify_repair', 'system'),
  t('2026-08-17T05:26:54.664Z', 'phase_completed:implementer', 'implementer'),
];

describe('detectRepeatLoop — #616 false positive (concern #621 repro)', () => {
  // taskStatus is the non-terminal value #616 had at detection time, so the
  // null must come from the forgiveness budget — not the terminal-status guard.
  it('does NOT flag task #616’s real window with production defaults', () => {
    expect(
      detectRepeatLoop({
        transitions: TASK_616_WINDOW,
        nowMs: DETECTED_AT_MS,
        taskStatus: 'in-progress',
      }),
    ).toBeNull();
  });

  // Contrast case: strip the verify_repair bounces that causally explain the
  // re-implements. With zero bounces the same 3 implementer firings are never
  // forgiven and MUST still be detected — proving the null above is earned by
  // the amnesty budget, not by window/actor filtering swallowing the firings.
  it('still flags the same window when the explaining bounces are absent', () => {
    expect(
      detectRepeatLoop({
        transitions: TASK_616_WINDOW.filter((tr) => tr.cause !== 'verify_repair'),
        nowMs: DETECTED_AT_MS,
        taskStatus: 'in-progress',
      }),
    ).toEqual({ cause: 'phase_completed:implementer', count: 3, via: 'general' });
  });
});
