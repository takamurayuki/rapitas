/**
 * log-health-suppressions.task-budget.test
 *
 * Task 1163: the task-budget "runaway spend" WARN is a designed guard report,
 * not a defect. Kept in its own file because log-health-suppressions.test.ts
 * is already past the 500-line hard limit.
 */
import { describe, test, expect } from 'bun:test';
import { classifyLogSignature } from './log-health-suppressions';
import { normalizeMessage } from './log-health-check';

describe('task 1163: [task-budget] runaway spend', () => {
  const runaway = '[task-budget] runaway spend — capping at economy';

  test('is suppressed for the task-budget logger with a reason', () => {
    const v = classifyLogSignature('task-budget', normalizeMessage(runaway));
    expect(v.suppressed).toBe(true);
    expect(v.because).toBeTruthy();
  });

  test('is not suppressed for another logger', () => {
    expect(classifyLogSignature('some-other-logger', normalizeMessage(runaway)).suppressed).toBe(
      false,
    );
  });

  test('sibling spend-lookup failure on the same logger stays visible', () => {
    const lookup =
      '[task-budget] spend lookup failed — deferring tier judgement, not treating as $0 spend';
    expect(classifyLogSignature('task-budget', normalizeMessage(lookup)).suppressed).toBe(false);
  });
});
