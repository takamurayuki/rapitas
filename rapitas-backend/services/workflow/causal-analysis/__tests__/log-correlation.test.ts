/**
 * log-correlation tests
 *
 * Covers window bounds, signal matching and missing timestamps.
 */
import { describe, it, expect } from 'bun:test';
import { countCorroboratingLogSignals } from '../log-correlation';
import { CAUSAL_WINDOW_MS } from '../root-cause-detector';

const onsetMs = 1_000_000;

describe('countCorroboratingLogSignals', () => {
  it('counts only stall WARNs inside [onset, onset + window]', () => {
    const n = countCorroboratingLogSignals({ onsetMs }, [
      { msg: 'Slow queue processing', time: onsetMs },
      { msg: 'Slow queue processing', time: onsetMs + CAUSAL_WINDOW_MS },
      { msg: 'Slow queue processing', time: onsetMs + CAUSAL_WINDOW_MS + 1 },
      { msg: 'Slow queue processing', time: onsetMs - 1 },
      { msg: 'Execution result ignored after cancellation', time: onsetMs + 5 },
      { msg: 'something else', time: onsetMs + 5 },
      { msg: 'Slow queue processing' },
    ]);
    expect(n).toBe(3);
  });

  it('returns 0 for no entries', () => {
    expect(countCorroboratingLogSignals({ onsetMs }, [])).toBe(0);
  });
});
