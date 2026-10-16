/**
 * log-health-suppressions.held-auto-run-excluded.test
 *
 * Verifies the suppression rule for the ThemeAutoRunScheduler resume-branch
 * WARN emitted when the current task is held via auto_run_excluded (task 1293).
 */
import { describe, test, expect } from 'bun:test';
import { classifyLogSignature } from './log-health-suppressions';

const LOGGER = 'theme-auto-run-scheduler';
const msg = (reason: string) =>
  `[ThemeAutoRunScheduler] Task # is held out of auto-run (${reason}) — not resuming it (theme #)`;

describe('task 1293: held out of auto-run (auto_run_excluded)', () => {
  test('is suppressed with a stated reason', () => {
    const v = classifyLogSignature(LOGGER, msg('auto_run_excluded'));
    expect(v.suppressed).toBe(true);
    expect(v.because).toBeTruthy();
  });

  test('does not leak to other hold reasons or loggers', () => {
    expect(classifyLogSignature(LOGGER, msg('halted')).suppressed).toBe(false);
    expect(classifyLogSignature(LOGGER, msg('workflow_disabled')).suppressed).toBe(false);
    expect(classifyLogSignature('other-logger', msg('auto_run_excluded')).suppressed).toBe(false);
  });
});
