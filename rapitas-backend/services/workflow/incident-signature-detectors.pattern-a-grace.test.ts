/**
 * incident-signature-detectors.pattern-a-grace.test
 *
 * Pattern A (`session_failed_execution_active`) settle-window boundary tests
 * (task 718), added as a new file rather than growing
 * incident-signature-detectors.test.ts past the component size limit —
 * mirrors the split already done for Pattern B in
 * incident-signature-detectors.pattern-b-grace.test.ts.
 */
import { describe, it, expect } from 'bun:test';
import {
  detectTriStateDesync,
  PATTERN_A_SETTLE_MS,
  type TriStateDesyncInput,
} from './incident-signature-detectors';

const NOW = 1_000_000_000_000;

describe('pattern A settle window (#718)', () => {
  const failing: TriStateDesyncInput = {
    taskStatus: 'in-progress',
    workflowStatus: 'research_done',
    latestSessionStatus: 'failed',
    latestExecutionStatus: 'running',
    latestSessionUpdatedAtMs: NOW - 60_000,
    nowMs: NOW,
  };

  it('does NOT detect pattern A 60s after the session failed (within grace)', () => {
    expect(detectTriStateDesync(failing)).toBeNull();
  });

  it('detects pattern A once the session update settled past the threshold', () => {
    const result = detectTriStateDesync({
      ...failing,
      latestSessionUpdatedAtMs: NOW - PATTERN_A_SETTLE_MS,
    });
    expect(result?.kind).toBe('session_failed_execution_active');
  });

  it('does NOT detect 1ms inside the grace window (>= boundary)', () => {
    expect(
      detectTriStateDesync({
        ...failing,
        latestSessionUpdatedAtMs: NOW - PATTERN_A_SETTLE_MS + 1,
      }),
    ).toBeNull();
  });

  it('honors a custom patternASettleMs override', () => {
    const custom = { ...failing, latestSessionUpdatedAtMs: NOW - 5_000, patternASettleMs: 4_000 };
    expect(detectTriStateDesync(custom)?.kind).toBe('session_failed_execution_active');
    expect(detectTriStateDesync({ ...custom, patternASettleMs: 6_000 })).toBeNull();
  });

  it('still detects immediately when latestSessionUpdatedAtMs is unknown (conservative)', () => {
    const { latestSessionUpdatedAtMs: _omitted, ...withoutTimestamp } = failing;
    expect(detectTriStateDesync(withoutTimestamp)?.kind).toBe('session_failed_execution_active');
  });

  it('still detects immediately when nowMs is not supplied (conservative, legacy callers)', () => {
    const { nowMs: _omitted, ...withoutNow } = failing;
    expect(detectTriStateDesync(withoutNow)?.kind).toBe('session_failed_execution_active');
  });

  it('does NOT let the settle window suppress pattern B', () => {
    const result = detectTriStateDesync({
      taskStatus: 'todo',
      workflowStatus: 'in_progress',
      latestSessionStatus: null,
      latestExecutionStatus: null,
      latestSessionUpdatedAtMs: NOW - 1_000,
      nowMs: NOW,
    });
    expect(result?.kind).toBe('todo_status_workflow_advanced');
  });
});
