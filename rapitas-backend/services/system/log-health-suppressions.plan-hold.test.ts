/**
 * log-health-suppressions.plan-hold.test
 *
 * Verifies the suppression rule for the plan-auto-approve forbidden-change
 * hold WARN (task 1296). Split from the main suppression test file, which is
 * already over the size limit.
 */
import { describe, test, expect } from 'bun:test';
import { classifyLogSignature } from './log-health-suppressions';

const MSG =
  '[plan-auto-approve] auto-approval withheld — plan needs a human forbidden-change override';

describe('task 1296: plan-auto-approve forbidden-change hold', () => {
  test('is suppressed for plan-auto-approve with a stated reason', () => {
    const v = classifyLogSignature('plan-auto-approve', MSG);
    expect(v.suppressed).toBe(true);
    expect(v.because).toBeTruthy();
  });

  test('does not leak to other loggers or other plan-auto-approve wordings', () => {
    expect(classifyLogSignature('some-other-logger', MSG).suppressed).toBe(false);
    expect(
      classifyLogSignature('plan-auto-approve', '[plan-auto-approve] failed to approve plan')
        .suppressed,
    ).toBe(false);
  });
});
