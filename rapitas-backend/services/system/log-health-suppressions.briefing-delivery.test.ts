/**
 * log-health-suppressions.briefing-delivery.test
 *
 * Task 1276: the briefing-delivery "Audio exceeded #s after # attempts" ERROR is
 * suppressed only for its exact normalized message and logger.
 */
import { describe, test, expect } from 'bun:test';
import { classifyLogSignature } from './log-health-suppressions';
import { normalizeMessage } from './log-health-check';

describe('briefing delivery audio-limit suppression', () => {
  test('is suppressed for reporting:briefing-delivery after normalization', () => {
    const verdict = classifyLogSignature(
      'reporting:briefing-delivery',
      normalizeMessage('Audio exceeded 180s after 5 attempts'),
    );
    expect(verdict.suppressed).toBe(true);
    expect(verdict.because).toBeTruthy();
  });

  test('is not suppressed for another logger', () => {
    expect(
      classifyLogSignature('other-logger', normalizeMessage('Audio exceeded 180s after 5 attempts'))
        .suppressed,
    ).toBe(false);
  });

  test('is not suppressed for a different message on the same logger', () => {
    for (const msg of ['Audio exceeded 180s after 5 attempts (extra)', 'boom (extra)']) {
      expect(
        classifyLogSignature('reporting:briefing-delivery', normalizeMessage(msg)).suppressed,
      ).toBe(false);
    }
  });

  test('suppresses the test-injected "boom" only on reporting:briefing-delivery', () => {
    const verdict = classifyLogSignature('reporting:briefing-delivery', normalizeMessage('boom'));
    expect(verdict.suppressed).toBe(true);
    expect(verdict.because).toBeTruthy();
    expect(classifyLogSignature('other-logger', normalizeMessage('boom')).suppressed).toBe(false);
  });
});
