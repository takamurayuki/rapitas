/**
 * incident-signature-detectors.blocked-escalation.test
 *
 * #980: a blocked task whose escalation notice is recent is a deliberate hold,
 * not stagnation. Kept separate from the main detector test (line-limit ratchet).
 */
import { describe, it, expect } from 'bun:test';
import {
  detectStagnation,
  isBlockedEscalationRecent,
  STAGNATION_THRESHOLD_MS,
  type StagnationInput,
} from './incident-signature-detectors';
import { BLOCKED_ESCALATION_CAUSES } from './self-incident-evidence';
import { BLOCKED_ESCALATED_CAUSE, BLOCKED_REESCALATED_CAUSE } from './blocked-task-escalation';

const NOW = 1_000_000_000_000;
const base: StagnationInput = {
  taskStatus: 'blocked',
  workflowStatus: 'in_progress',
  lastActivityAtMs: NOW - STAGNATION_THRESHOLD_MS - 60_000,
  hasLiveExecution: false,
  hasAnyExecution: true,
  hasActiveQueueItem: false,
  nowMs: NOW,
};

describe('detectStagnation blockedEscalationRecent (#980)', () => {
  it('does not detect a blocked task with a recent escalation', () => {
    expect(detectStagnation({ ...base, blockedEscalationRecent: true })).toBeNull();
  });
  it('detects when the escalation is not recent (false)', () => {
    expect(detectStagnation({ ...base, blockedEscalationRecent: false })).not.toBeNull();
  });
  it('detects when the flag is omitted or null (fail-open)', () => {
    expect(detectStagnation(base)).not.toBeNull();
    expect(detectStagnation({ ...base, blockedEscalationRecent: null })).not.toBeNull();
  });
  it('only exempts blocked tasks', () => {
    expect(
      detectStagnation({ ...base, taskStatus: 'todo', blockedEscalationRecent: true }),
    ).not.toBeNull();
  });
  it('evidence cause list matches the escalation module constants', () => {
    expect(BLOCKED_ESCALATION_CAUSES).toEqual([BLOCKED_ESCALATED_CAUSE, BLOCKED_REESCALATED_CAUSE]);
  });
});

describe('isBlockedEscalationRecent (#980)', () => {
  const H = 60 * 60 * 1000;
  it('is true for a notice 3h ago', () => {
    expect(isBlockedEscalationRecent(NOW - 3 * H, NOW)).toBe(true);
  });
  it('is false for a notice 5h ago (notifier presumed dead)', () => {
    expect(isBlockedEscalationRecent(NOW - 5 * H, NOW)).toBe(false);
  });
  it('is false at the 4.5h boundary and true just inside it', () => {
    expect(isBlockedEscalationRecent(NOW - 4.5 * H, NOW)).toBe(false);
    expect(isBlockedEscalationRecent(NOW - 4.5 * H + 1, NOW)).toBe(true);
  });
  it('is false when there is no notice / lookup failed', () => {
    expect(isBlockedEscalationRecent(null, NOW)).toBe(false);
  });
});
