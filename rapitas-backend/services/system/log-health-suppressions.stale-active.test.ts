/**
 * log-health-suppressions.stale-active.test
 *
 * Verifies the suppression rule for the workflow-runner-stale-active self-heal
 * WARN (task 1297). Split from the main suppression test file, which is already
 * over the size limit.
 */
import { describe, test, expect } from 'bun:test';
import { classifyLogSignature } from './log-health-suppressions';

const MESSAGE =
  '[WorkflowRunner] activeExecutions entry has no running DB item — dropping (self-heal)';

describe('task 1297: activeExecutions stale-entry self-heal', () => {
  test('is suppressed for workflow-runner-stale-active with a stated reason', () => {
    const v = classifyLogSignature('workflow-runner-stale-active', MESSAGE);
    expect(v.suppressed).toBe(true);
    expect(v.because).toBeTruthy();
  });

  test('does not leak to other loggers or sibling wordings', () => {
    expect(classifyLogSignature('some-other-logger', MESSAGE).suppressed).toBe(false);
    expect(
      classifyLogSignature(
        'workflow-runner-stale-active',
        '[WorkflowRunner] stale-active check failed; keeping entries',
      ).suppressed,
    ).toBe(false);
    expect(
      classifyLogSignature(
        'workflow-runner-stale-active',
        '[WorkflowRunner] Released activeExecutions entry after external cancel',
      ).suppressed,
    ).toBe(false);
  });
});
