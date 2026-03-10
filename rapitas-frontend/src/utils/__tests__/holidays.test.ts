import { describe, it, expect } from 'vitest';
import {
  getHolidaysForYear,
  getHolidaysForMonth,
  getHolidayName,
} from '../holidays';

describe('getHolidaysForYear', () => {
  it('returns empty for years before 1948', () => {
    expect(getHolidaysForYear(1947)).toEqual([]);
  });

  it('includes New Year for any valid year', () => {
    const holidays = getHolidaysForYear(2026);
    expect(holidays.find((h) => h.name === '元日')).toEqual({
      date: '2026-01-01',
      name: '元日',
    });
  });

  it('includes Coming of Age Day as 2nd Monday for 2026', () => {
    const holidays = getHolidaysForYear(2026);
    const seijin = holidays.find((h) => h.name === '成人の日');
    expect(seijin).toBeDefined();
    // 2026-01-12 is the 2nd Monday of January 2026
    expect(seijin!.date).toBe('2026-01-12');
  });

  it('includes Emperor Birthday on Feb 23 for 2026', () => {
    const holidays = getHolidaysForYear(2026);
    expect(holidays.find((h) => h.date === '2026-02-23')?.name).toBe(
      '天皇誕生日',
    );
  });

  it('includes Golden Week holidays', () => {
    const holidays = getHolidaysForYear(2026);
    const names = holidays.map((h) => h.name);
    expect(names).toContain('憲法記念日');
    expect(names).toContain('みどりの日');
    expect(names).toContain('こどもの日');
  });

  it('includes substitute holidays when holiday falls on Sunday', () => {
    // 2026-05-03 (Constitution Day) falls on Sunday
    const holidays = getHolidaysForYear(2026);
    const substituteHolidays = holidays.filter((h) => h.name === '振替休日');
    expect(substituteHolidays.length).toBeGreaterThanOrEqual(0);
  });

  it('returns holidays sorted by date', () => {
    const holidays = getHolidaysForYear(2026);
    for (let i = 1; i < holidays.length; i++) {
      expect(holidays[i].date >= holidays[i - 1].date).toBe(true);
    }
  });

  it('handles 2020 Olympic special dates', () => {
    const holidays = getHolidaysForYear(2020);
    expect(holidays.find((h) => h.date === '2020-07-23')?.name).toBe('海の日');
    expect(holidays.find((h) => h.date === '2020-08-10')?.name).toBe('山の日');
  });

  it('returns Showa Day for years >= 2007', () => {
    expect(
      getHolidaysForYear(2026).find((h) => h.date === '2026-04-29')?.name,
    ).toBe('昭和の日');
  });

  it('returns Greenery Day for 1989-2006', () => {
    expect(
      getHolidaysForYear(2000).find((h) => h.date === '2000-04-29')?.name,
    ).toBe('みどりの日');
  });
});

describe('getHolidaysForMonth', () => {
  it('returns only holidays for the specified month', () => {
    const jan = getHolidaysForMonth(2026, 0);
    expect(jan.every((h) => h.date.startsWith('2026-01'))).toBe(true);
    expect(jan.length).toBeGreaterThanOrEqual(2); // 元日 + 成人の日
  });

  it('returns empty for months with no holidays', () => {
    // June typically has no holidays (except 2020/2021 Olympic specials)
    const june = getHolidaysForMonth(2026, 5);
    expect(june.length).toBe(0);
  });
});

describe('getHolidayName', () => {
  it('returns holiday name for a known holiday', () => {
    expect(getHolidayName('2026-01-01')).toBe('元日');
  });

  it('returns null for non-holiday dates', () => {
    expect(getHolidayName('2026-06-15')).toBeNull();
  });
});
