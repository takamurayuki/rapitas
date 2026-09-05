/**
 * concern-recurrence-candidates.test
 *
 * Tests for the pure candidate-selection helpers used by
 * concern-recurrence-policy.ts's resolveRecurrence (task #857).
 */
import { describe, it, expect } from 'bun:test';
import { pickSuppressingCandidate, pickLatestDoneCandidate } from './concern-recurrence-candidates';

const MIN_MS = 60 * 1000;
const HOUR_MS = 60 * MIN_MS;
const DAY_MS = 24 * HOUR_MS;

type Row = { id: number; createdAt: Date };

describe('pickSuppressingCandidate', () => {
  it('returns null for an empty candidate list', () => {
    expect(pickSuppressingCandidate([], Date.now(), HOUR_MS)).toBeNull();
  });

  it('returns the row when its createdAt falls within the suppress window', () => {
    const nowMs = Date.now();
    const row: Row = { id: 1, createdAt: new Date(nowMs - 10 * MIN_MS) };
    const result = pickSuppressingCandidate([{ row, completedAt: null }], nowMs, HOUR_MS);
    expect(result).toBe(row);
  });

  it('returns null when the only candidate was created outside the suppress window', () => {
    const nowMs = Date.now();
    const row: Row = { id: 1, createdAt: new Date(nowMs - 2 * HOUR_MS) };
    const result = pickSuppressingCandidate([{ row, completedAt: null }], nowMs, HOUR_MS);
    expect(result).toBeNull();
  });

  it('picks the most recently created row among several within the window', () => {
    const nowMs = Date.now();
    const older: Row = { id: 1, createdAt: new Date(nowMs - 40 * MIN_MS) };
    const newer: Row = { id: 2, createdAt: new Date(nowMs - 5 * MIN_MS) };
    const result = pickSuppressingCandidate(
      [
        { row: older, completedAt: null },
        { row: newer, completedAt: null },
      ],
      nowMs,
      HOUR_MS,
    );
    expect(result).toBe(newer);
  });
});

describe('pickLatestDoneCandidate', () => {
  it('returns null for an empty candidate list', () => {
    expect(pickLatestDoneCandidate([], Date.now(), 14 * DAY_MS)).toBeNull();
  });

  it('excludes candidates with no completedAt', () => {
    const nowMs = Date.now();
    const row: Row = { id: 1, createdAt: new Date(nowMs - DAY_MS) };
    const result = pickLatestDoneCandidate([{ row, completedAt: null }], nowMs, 14 * DAY_MS);
    expect(result).toBeNull();
  });

  it('returns null when the only candidate completed outside the window', () => {
    const nowMs = Date.now();
    const row: Row = { id: 1, createdAt: new Date(nowMs - 20 * DAY_MS) };
    const result = pickLatestDoneCandidate(
      [{ row, completedAt: new Date(nowMs - 20 * DAY_MS) }],
      nowMs,
      14 * DAY_MS,
    );
    expect(result).toBeNull();
  });

  it('picks the most recently completed row among several terminal candidates, regardless of order', () => {
    const nowMs = Date.now();
    const older: Row = { id: 1, createdAt: new Date(nowMs - 13 * DAY_MS) };
    const newer: Row = { id: 2, createdAt: new Date(nowMs - 2 * DAY_MS) };
    const olderCandidate = { row: older, completedAt: new Date(nowMs - 10 * DAY_MS) };
    const newerCandidate = { row: newer, completedAt: new Date(nowMs - 1 * DAY_MS) };

    const forward = pickLatestDoneCandidate([olderCandidate, newerCandidate], nowMs, 14 * DAY_MS);
    const reversed = pickLatestDoneCandidate([newerCandidate, olderCandidate], nowMs, 14 * DAY_MS);

    expect(forward).toBe(newer);
    expect(reversed).toBe(newer);
  });
});
