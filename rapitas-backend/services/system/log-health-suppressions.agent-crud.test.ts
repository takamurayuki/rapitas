/**
 * log-health-suppressions.agent-crud.test
 *
 * Verifies the suppression rule for the non-numeric agent id WARN
 * (task 1303) emitted by GET /agents/:id.
 */
import { describe, test, expect } from 'bun:test';
import { classifyLogSignature } from './log-health-suppressions';

const MSG = '[agents] Non-numeric agent id requested';

describe('task 1303: non-numeric agent id', () => {
  test('is suppressed for routes:agent-crud with a stated reason', () => {
    const v = classifyLogSignature('routes:agent-crud', MSG);
    expect(v.suppressed).toBe(true);
    expect(v.because).toBeTruthy();
  });

  test('does not leak to other loggers or other agent-crud wordings', () => {
    expect(classifyLogSignature('some-other-logger', MSG).suppressed).toBe(false);
    expect(
      classifyLogSignature('routes:agent-crud', '[agents] Failed to load agent').suppressed,
    ).toBe(false);
    expect(classifyLogSignature('routes:agent-crud', MSG + ' again').suppressed).toBe(false);
  });
});
