/**
 * goal-reflection-week.test
 *
 * The week key must agree with the server's: Monday, Asia/Tokyo.
 */
import { describe, it, expect } from 'vitest';
import { currentWeekStart, noteLength } from './goal-reflection-week';

describe('currentWeekStart', () => {
  it('returns the Monday of the week in Asia/Tokyo', () => {
    expect(currentWeekStart(new Date('2026-11-26T03:00:00Z'))).toBe('2026-11-23');
  });

  it('keeps Sunday 23:59 JST in the week and starts the next at Monday 00:00 JST', () => {
    expect(currentWeekStart(new Date('2026-11-29T14:59:00Z'))).toBe('2026-11-23');
    expect(currentWeekStart(new Date('2026-11-29T15:00:00Z'))).toBe('2026-11-30');
  });

  it('crosses a year boundary', () => {
    expect(currentWeekStart(new Date('2027-01-01T00:00:00Z'))).toBe('2026-12-28');
  });
});

describe('noteLength', () => {
  it('counts an emoji once, as the server does', () => {
    expect(noteLength('😀'.repeat(500))).toBe(500);
    expect(noteLength('')).toBe(0);
  });
});
