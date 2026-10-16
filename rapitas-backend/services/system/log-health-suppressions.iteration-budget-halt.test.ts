/**
 * log-health-suppressions.iteration-budget-halt.test
 *
 * Task 1292: the repeat_cause_detected iteration-budget halt WARN is a designed
 * guard report, not a defect. Other halt reasons must stay visible.
 */
import { describe, test, expect } from 'bun:test';
import { classifyLogSignature } from './log-health-suppressions';
import { normalizeMessage } from './log-health-check';

const LOGGER = 'theme-auto-run-scheduler';
const halted = (reason: string) =>
  `[ThemeAutoRunScheduler] Task 1257 halted by iteration budget (${reason})`;

describe('task 1292: iteration budget halt WARN', () => {
  test('repeat_cause_detected is suppressed with a reason', () => {
    const v = classifyLogSignature(LOGGER, normalizeMessage(halted('repeat_cause_detected')));
    expect(v.suppressed).toBe(true);
    expect(v.because).toBeTruthy();
  });

  test('is not suppressed for another logger', () => {
    expect(
      classifyLogSignature('some-other-logger', normalizeMessage(halted('repeat_cause_detected')))
        .suppressed,
    ).toBe(false);
  });

  test.each([
    'budget_time_exceeded',
    'budget_cost_exceeded',
    'budget_attempts_exceeded',
    'no_progress',
  ])('other halt reason %s stays visible', (reason) => {
    expect(classifyLogSignature(LOGGER, normalizeMessage(halted(reason))).suppressed).toBe(false);
  });
});
