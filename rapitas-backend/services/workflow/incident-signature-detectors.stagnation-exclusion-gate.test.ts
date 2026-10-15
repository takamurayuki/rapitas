/**
 * incident-signature-detectors.stagnation-exclusion-gate.test
 *
 * Unit coverage for the `taskHalted` / `autoRunExcluded` gates on
 * detectStagnation (task #1203): the auto-run selector never picks such tasks,
 * so "no execution, no queue" is intended, not stagnation. Fail-open when unset.
 */
import { describe, it, expect } from 'bun:test';
import {
  detectStagnation,
  STAGNATION_THRESHOLD_MS,
  type StagnationInput,
} from './incident-signature-detectors';

const NOW = 1_000_000_000_000;

describe('detectStagnation: taskHalted / autoRunExcluded gates (#1203)', () => {
  const orphan: StagnationInput = {
    taskStatus: 'todo',
    workflowStatus: 'in_progress',
    lastActivityAtMs: NOW - STAGNATION_THRESHOLD_MS - 60_000,
    hasLiveExecution: false,
    hasAnyExecution: true,
    hasActiveQueueItem: false,
    nowMs: NOW,
  };

  it('returns null when autoRunExcluded is true', () => {
    expect(detectStagnation({ ...orphan, autoRunExcluded: true })).toBeNull();
  });

  it('returns null when taskHalted is true', () => {
    expect(detectStagnation({ ...orphan, taskHalted: true })).toBeNull();
  });

  it('still detects when both are unspecified (fail-open)', () => {
    expect(detectStagnation(orphan)).not.toBeNull();
  });

  it('still detects when both are false or null', () => {
    expect(
      detectStagnation({ ...orphan, taskHalted: false, autoRunExcluded: false }),
    ).not.toBeNull();
    expect(detectStagnation({ ...orphan, taskHalted: null, autoRunExcluded: null })).not.toBeNull();
  });
});
