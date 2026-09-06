/**
 * event-loop-lag-watchdog.test
 *
 * Verifies the stall message always uses a fixed one-decimal-place digit
 * shape so integer-second and fractional-second lags fold into the same
 * "~#.#s" normalized signature instead of splitting concern series (task #864).
 */
import { describe, it, expect } from 'bun:test';
import { formatEventLoopLagMessage } from './event-loop-lag-watchdog';

function normalize(msg: string): string {
  return msg.replace(/\d+/g, '#');
}

describe('formatEventLoopLagMessage', () => {
  it('formats a fractional-second lag with one decimal place', () => {
    expect(formatEventLoopLagMessage(2161)).toBe('Event loop stalled ~2.2s');
  });

  it('formats an integer-second lag with a trailing .0 (not bare seconds)', () => {
    expect(formatEventLoopLagMessage(2001)).toBe('Event loop stalled ~2.0s');
  });

  it('normalizes integer-second and fractional-second lags to the same signature', () => {
    const integerLagMsg = formatEventLoopLagMessage(2001);
    const fractionalLagMsg = formatEventLoopLagMessage(2161);
    expect(normalize(integerLagMsg)).toBe(normalize(fractionalLagMsg));
    expect(normalize(integerLagMsg)).toBe('Event loop stalled ~#.#s');
  });

  it('normalizes a large lag (11354ms) to the same signature shape', () => {
    expect(normalize(formatEventLoopLagMessage(11354))).toBe('Event loop stalled ~#.#s');
  });
});
