/**
 * workflow-reconciler.test
 *
 * Pure-logic tests for the zombie-session finalize decision: only abandoned
 * (stale, non-awaiting) active sessions are finalized — never a live long phase
 * or a session legitimately waiting on the user.
 */
import { describe, it, expect } from 'bun:test';
import { shouldFinalizeSession, STALE_SESSION_MS } from './workflow-reconciler';

const NOW = 1_000_000_000_000;
const stale = NOW - STALE_SESSION_MS - 1; // just past the threshold
const fresh = NOW - 60_000; // 1 min ago

describe('shouldFinalizeSession', () => {
  it('finalizes a stale, non-awaiting active session', () => {
    expect(shouldFinalizeSession({ lastActivityAtMs: stale, nowMs: NOW })).toBe(true);
  });

  it.each([
    {
      name: 'a session within the staleness window (live long phase)',
      input: { lastActivityAtMs: fresh, nowMs: NOW },
    },
    {
      name: 'a session awaiting user input',
      input: { lastActivityAtMs: stale, nowMs: NOW, latestExecStatus: 'waiting_for_input' },
    },
    {
      name: 'a task awaiting a clarifying question',
      input: { lastActivityAtMs: stale, nowMs: NOW, taskWorkflowStatus: 'awaiting_question' },
    },
  ])('does NOT finalize $name', ({ input }) => {
    expect(shouldFinalizeSession(input)).toBe(false);
  });

  it('staleness threshold exceeds the 30m phase timeout (no false finalize of a max-length phase)', () => {
    expect(STALE_SESSION_MS).toBeGreaterThan(30 * 60 * 1000);
  });
});
