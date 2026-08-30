import { describe, it, expect } from 'bun:test';
import { generateSummary, extractTestStats } from './phase-summary-metrics';
import type { PhaseIteration } from './phase-segmentation';

function iteration(overrides: Partial<PhaseIteration>): PhaseIteration {
  return {
    iterationNumber: 1,
    executionIds: [1],
    startedAt: '2026-08-30T00:00:00.000Z',
    completedAt: '2026-08-30T00:01:23.000Z',
    status: 'completed',
    logLineCount: 42,
    boundaryUncertain: false,
    ...overrides,
  };
}

describe('extractTestStats', () => {
  it('extracts pass and fail counts from log text', () => {
    expect(extractTestStats('24 pass, 0 fail')).toEqual({ pass: 24, fail: 0 });
    expect(extractTestStats('12 passed, 3 failed')).toEqual({ pass: 12, fail: 3 });
  });

  it('returns null when neither pattern matches', () => {
    expect(extractTestStats('no test markers here')).toBeNull();
  });

  it('defaults the missing side to 0 when only one pattern matches', () => {
    expect(extractTestStats('24 passed')).toEqual({ pass: 24, fail: 0 });
  });
});

describe('generateSummary', () => {
  it('computes duration and log line count for a completed non-verify phase', () => {
    const summary = generateSummary(iteration({}), 'implement');
    expect(summary.status).toBe('completed');
    expect(summary.durationMs).toBe(83000);
    expect(summary.logLineCount).toBe(42);
    expect(summary.testPass).toBeNull();
    expect(summary.testFail).toBeNull();
  });

  it('extracts pass/fail counts only for the verify phase', () => {
    const summary = generateSummary(iteration({}), 'verify', '24 pass / 0 fail');
    expect(summary.testPass).toBe(24);
    expect(summary.testFail).toBe(0);
  });

  it('does not extract test stats for non-verify phases even if the text matches', () => {
    const summary = generateSummary(iteration({}), 'implement', '24 pass / 0 fail');
    expect(summary.testPass).toBeNull();
    expect(summary.testFail).toBeNull();
  });

  it('returns a null duration for a still-running iteration', () => {
    const summary = generateSummary(
      iteration({ status: 'running', completedAt: null }),
      'research',
    );
    expect(summary.durationMs).toBeNull();
    expect(summary.status).toBe('running');
  });
});
