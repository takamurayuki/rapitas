/**
 * sample-gate.test
 *
 * The improvement digest already dropped thin-sample rates; the detail charts
 * and the retro KPI section did not, so a 590-minute lead-time median over two
 * tasks sat on the same line as 35 minutes over 28 and fed the "vs last week"
 * badge (#1304). This pins the shared threshold both now use.
 */
import { describe, it, expect } from 'vitest';
import { gatedBySample, MIN_RATE_SAMPLE } from '../components/sample-gate';

describe('gatedBySample', () => {
  it('passes a value whose sample reaches the threshold', () => {
    expect(gatedBySample(0.64, MIN_RATE_SAMPLE)).toBe(0.64);
  });

  it('withholds a value one sample short', () => {
    expect(gatedBySample(1, MIN_RATE_SAMPLE - 1)).toBeNull();
  });

  // The two shapes that caused this: a perfect rate off one task, and a median
  // off two. Both read as measurements and neither is one.
  it('withholds a perfect rate off a single sample', () => {
    expect(gatedBySample(1, 1)).toBeNull();
  });

  it('withholds a median off two samples', () => {
    expect(gatedBySample(590, 2)).toBeNull();
  });

  it('keeps an unmeasured value null rather than inventing one', () => {
    expect(gatedBySample(null, 100)).toBeNull();
  });

  // 0 is a real rate — "nothing needed repair" — and must survive the gate
  // once the sample is there.
  it('passes a zero rate on an adequate sample', () => {
    expect(gatedBySample(0, MIN_RATE_SAMPLE)).toBe(0);
  });

  it('withholds everything at an empty denominator', () => {
    expect(gatedBySample(0.5, 0)).toBeNull();
  });
});
