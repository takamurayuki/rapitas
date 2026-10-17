/**
 * log-health-suppressions.repair-cutoff.test
 *
 * Verifies the suppression rule for the verify-repair non-convergence cutoff
 * WARN (task 1301). Kept separate from the main suppression test file, which
 * is already over the size limit.
 */
import { describe, test, expect } from 'bun:test';
import { classifyLogSignature } from './log-health-suppressions';

const LOGGER = 'workflow:verify-self-repair';
const MSG = '[verify-repair] Repair loop not converging — cutting off (caller should block)';

describe('task 1301: verify-repair non-convergence cutoff', () => {
  test('is suppressed for verify-self-repair with a stated reason', () => {
    const v = classifyLogSignature(LOGGER, MSG);
    expect(v.suppressed).toBe(true);
    expect(v.because).toBeTruthy();
  });

  test('does not leak to other loggers or sibling non-convergence logs', () => {
    expect(classifyLogSignature('some-other-logger', MSG).suppressed).toBe(false);
    expect(
      classifyLogSignature(
        'workflow:verify-invariant-repair',
        '[verify-repair] Invariant violation not converging — stopping',
      ).suppressed,
    ).toBe(false);
    expect(
      classifyLogSignature(LOGGER, '[verify-repair] Lifetime repair cap exceeded').suppressed,
    ).toBe(false);
  });
});
