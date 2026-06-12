/**
 * backlog-scheduler.test
 *
 * Unit tests for the scheduler's pure due-check (isJobDue). DB/LLM/git paths are
 * covered elsewhere; this locks down the timing logic.
 */
import { describe, it, expect } from 'bun:test';
import { isJobDue } from './backlog-scheduler';
import { normalizeJobKind, type BacklogScheduleConfig } from './backlog-schedule-service';

/** Builds a schedule config with sensible defaults, overridable per-test. */
function makeSchedule(over: Partial<BacklogScheduleConfig> = {}): BacklogScheduleConfig {
  return {
    kind: 'innovation',
    enabled: true,
    frequency: 'daily',
    hour: 3,
    weekday: 1,
    lastRunAt: null,
    ...over,
  };
}

// 2024-01-15 is a Monday (getDay() === 1).
const MONDAY_3AM = new Date(2024, 0, 15, 3, 30, 0);
const MONDAY_4AM = new Date(2024, 0, 15, 4, 30, 0);
const TUESDAY_3AM = new Date(2024, 0, 16, 3, 30, 0);

describe('isJobDue', () => {
  it('fires a daily job at the matching hour', () => {
    expect(isJobDue(makeSchedule({ frequency: 'daily', hour: 3 }), MONDAY_3AM)).toBe(true);
  });

  it('does not fire when the hour does not match', () => {
    expect(isJobDue(makeSchedule({ frequency: 'daily', hour: 3 }), MONDAY_4AM)).toBe(false);
  });

  it('never fires when disabled', () => {
    expect(isJobDue(makeSchedule({ enabled: false, hour: 3 }), MONDAY_3AM)).toBe(false);
  });

  it('fires a weekly job only on the matching weekday', () => {
    const weeklyMonday = makeSchedule({ frequency: 'weekly', hour: 3, weekday: 1 });
    expect(isJobDue(weeklyMonday, MONDAY_3AM)).toBe(true);
    expect(isJobDue(weeklyMonday, TUESDAY_3AM)).toBe(false);
  });

  it('ignores weekday for daily jobs', () => {
    const daily = makeSchedule({ frequency: 'daily', hour: 3, weekday: 6 });
    expect(isJobDue(daily, MONDAY_3AM)).toBe(true);
  });

  it('does not fire twice on the same day', () => {
    const ranToday = makeSchedule({ hour: 3, lastRunAt: new Date(2024, 0, 15, 3, 1, 0) });
    expect(isJobDue(ranToday, MONDAY_3AM)).toBe(false);
  });

  it('fires again the next day after a prior run', () => {
    // Ran Monday; on Tuesday at the same hour a daily job is due again.
    const ranMonday = makeSchedule({
      frequency: 'daily',
      hour: 3,
      lastRunAt: new Date(2024, 0, 15, 3, 1, 0),
    });
    expect(isJobDue(ranMonday, TUESDAY_3AM)).toBe(true);
  });
});

describe('normalizeJobKind', () => {
  it('accepts known kinds', () => {
    expect(normalizeJobKind('innovation')).toBe('innovation');
    expect(normalizeJobKind('vuln_scan')).toBe('vuln_scan');
  });

  it('rejects unknown values as null', () => {
    expect(normalizeJobKind('bogus')).toBeNull();
    expect(normalizeJobKind(undefined)).toBeNull();
    expect(normalizeJobKind(42)).toBeNull();
  });
});
