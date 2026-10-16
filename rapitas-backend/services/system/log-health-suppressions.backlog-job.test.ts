/**
 * log-health-suppressions.backlog-job.test
 *
 * Verifies the suppression rule for the scheduling:backlog `Backlog job ran`
 * duration WARN (task 1295).
 */
import { describe, test, expect } from 'bun:test';
import { classifyLogSignature } from './log-health-suppressions';

describe('task 1295: Backlog job ran', () => {
  test('is suppressed for integer and decimal durations with a stated reason', () => {
    for (const msg of ['Backlog job ran #s', 'Backlog job ran #.#s']) {
      const v = classifyLogSignature('scheduling:backlog', msg);
      expect(v.suppressed).toBe(true);
      expect(v.because).toBeTruthy();
    }
  });

  test('does not leak to other loggers or other backlog wordings', () => {
    expect(classifyLogSignature('other-logger', 'Backlog job ran #s').suppressed).toBe(false);
    expect(classifyLogSignature('scheduling:backlog', 'Backlog job failed').suppressed).toBe(false);
  });
});
