/**
 * briefing-wav.test
 *
 * Boundary tests of the WAV duration measurement used to prove the 180 s cap
 * on real audio rather than on a character estimate.
 */
import { describe, it, expect } from 'bun:test';
import { readWavDurationSeconds, buildSilentWav } from '../briefing-wav';

describe('readWavDurationSeconds', () => {
  it('measures 1 second and 180 seconds exactly', () => {
    expect(readWavDurationSeconds(buildSilentWav(1))).toBeCloseTo(1, 5);
    expect(readWavDurationSeconds(buildSilentWav(180))).toBeCloseTo(180, 5);
  });
  it('measures 181 seconds above the cap', () => {
    expect(readWavDurationSeconds(buildSilentWav(181))).toBeGreaterThan(180);
  });
  it('rejects a buffer without RIFF/WAVE header', () => {
    expect(() => readWavDurationSeconds(new Uint8Array(64))).toThrow();
  });
  it('rejects a WAV without a data chunk', () => {
    const wav = buildSilentWav(1);
    const broken = wav.slice(0, 36); // header up to the end of fmt chunk
    expect(() => readWavDurationSeconds(broken)).toThrow();
  });
});
