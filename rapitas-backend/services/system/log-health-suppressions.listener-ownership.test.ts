/**
 * log-health-suppressions.listener-ownership.test
 *
 * Task 1235: the runtime-smoke registry's fail-closed "Listener ownership is
 * unconfirmed" ERROR is suppressed only for its exact message and logger.
 * Kept apart from log-health-suppressions.test.ts, which is over its size limit.
 */
import { describe, test, expect } from 'bun:test';
import { classifyLogSignature } from './log-health-suppressions';
import { normalizeMessage } from './log-health-check';

describe('listener ownership unconfirmed suppression', () => {
  test('is suppressed for the runtime-smoke:registry logger after normalization', () => {
    const verdict = classifyLogSignature(
      'runtime-smoke:registry',
      normalizeMessage('Listener ownership is unconfirmed'),
    );
    expect(verdict.suppressed).toBe(true);
    expect(verdict.because).toBeTruthy();
  });

  test('is not suppressed for another logger', () => {
    expect(
      classifyLogSignature(
        'worktree-server-registry',
        normalizeMessage('Listener ownership is unconfirmed'),
      ).suppressed,
    ).toBe(false);
  });

  test('is not suppressed when the message has a suffix or a sibling wording', () => {
    for (const msg of [
      'Listener ownership is unconfirmed (extra)',
      'Server ownership changed during start',
    ]) {
      expect(classifyLogSignature('runtime-smoke:registry', normalizeMessage(msg)).suppressed).toBe(
        false,
      );
    }
  });
});
