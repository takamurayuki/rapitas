import { describe, it, expect, vi, afterEach } from 'vitest';
import { getDefaultTimes, toUTCISO, calcDayCount, resolveEndAt } from '../schedule-utils';

describe('getDefaultTimes', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('rounds up to :30 within the same hour when minutes <= 30', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 1, 10, 15));
    expect(getDefaultTimes()).toEqual({ start: '10:30', end: '11:30' });
  });

  it('rounds up to the next hour at :00 when minutes > 30', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 1, 10, 45));
    expect(getDefaultTimes()).toEqual({ start: '11:00', end: '12:00' });
  });

  it('falls back to 09:00 when rounding up would cross midnight', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 1, 23, 45));
    expect(getDefaultTimes()).toEqual({ start: '09:00', end: '10:00' });
  });

  it('wraps the end time across midnight without falling back', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 1, 23, 15));
    expect(getDefaultTimes()).toEqual({ start: '23:30', end: '00:30' });
  });
});

describe('toUTCISO', () => {
  it('converts a date and time to a UTC ISO string', () => {
    expect(toUTCISO('2026-03-15', '09:30')).toBe('2026-03-15T09:30:00.000Z');
  });

  it('defaults the time to 00:00 when omitted', () => {
    expect(toUTCISO('2026-03-15')).toBe('2026-03-15T00:00:00.000Z');
  });
});

describe('calcDayCount', () => {
  it('counts inclusive days for a multi-day range', () => {
    expect(calcDayCount('2026-01-01', '2026-01-05')).toBe(5);
  });

  it('returns 1 when start and end are the same day', () => {
    expect(calcDayCount('2026-01-01', '2026-01-01')).toBe(1);
  });

  it('returns 1 when end is before start', () => {
    expect(calcDayCount('2026-01-05', '2026-01-01')).toBe(1);
  });
});

describe('resolveEndAt', () => {
  it('returns next-day midnight UTC for an all-day multi-day event', () => {
    const result = resolveEndAt('2026-01-01', '2026-01-03', '09:00', '10:00', true, true);
    expect(result).toBe('2026-01-04T00:00:00.000Z');
  });

  it('returns undefined for an all-day single-day event', () => {
    const result = resolveEndAt('2026-01-01', '2026-01-01', '09:00', '10:00', true, false);
    expect(result).toBeUndefined();
  });

  it('returns undefined for an all-day event where endDate does not exceed startDate', () => {
    const result = resolveEndAt('2026-01-01', '2026-01-01', '00:00', '00:00', true, true);
    expect(result).toBeUndefined();
  });

  it('uses the end date/time for a timed multi-day event', () => {
    const result = resolveEndAt('2026-01-01', '2026-01-03', '09:00', '17:00', false, true);
    expect(result).toBe('2026-01-03T17:00:00.000Z');
  });

  it('wraps to the next day for a single-day event whose end time precedes its start time', () => {
    const result = resolveEndAt('2026-01-01', '2026-01-01', '23:00', '02:00', false, false);
    expect(result).toBe('2026-01-02T02:00:00.000Z');
  });

  it('uses the same day for a normal single-day timed event', () => {
    const result = resolveEndAt('2026-01-01', '2026-01-01', '09:00', '17:00', false, false);
    expect(result).toBe('2026-01-01T17:00:00.000Z');
  });
});
