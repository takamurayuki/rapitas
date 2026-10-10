/**
 * log-health-suppressions.slow-queue.test
 *
 * Verifies the suppression rule for the workflow-runner `Slow queue processing`
 * diagnostic WARN (task 1159). Split from the main suppression test file, which
 * is already over the size limit.
 */
import { describe, test, expect } from 'bun:test';
import { classifyLogSignature } from './log-health-suppressions';

describe('task 1159: Slow queue processing', () => {
  test('is suppressed for workflow-runner with a stated reason', () => {
    const v = classifyLogSignature('workflow-runner', 'Slow queue processing');
    expect(v.suppressed).toBe(true);
    expect(v.because).toBeTruthy();
  });

  test('does not leak to other loggers or other workflow-runner wordings', () => {
    expect(classifyLogSignature('some-other-logger', 'Slow queue processing').suppressed).toBe(
      false,
    );
    expect(classifyLogSignature('workflow-runner', 'Error in processQueue').suppressed).toBe(false);
  });
});
