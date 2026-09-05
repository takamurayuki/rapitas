import { describe, it, expect, vi, afterEach } from 'vitest';
import { formatDistanceToNow, formatDate, formatDateTime, formatTime } from '../date';

describe('formatDistanceToNow', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns "たった今" for less than 60 seconds', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T12:00:30'));
    expect(formatDistanceToNow(new Date('2026-01-01T12:00:00'))).toBe('たった今');
  });

  it('returns minutes for less than 60 minutes', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T12:05:00'));
    expect(formatDistanceToNow(new Date('2026-01-01T12:00:00'))).toBe('5分前');
  });

  it('returns hours for less than 24 hours', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T15:00:00'));
    expect(formatDistanceToNow(new Date('2026-01-01T12:00:00'))).toBe('3時間前');
  });

  it('returns days for less than 30 days', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-08T12:00:00'));
    expect(formatDistanceToNow(new Date('2026-01-01T12:00:00'))).toBe('7日前');
  });

  it('returns months for less than 12 months', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-01T12:00:00'));
    expect(formatDistanceToNow(new Date('2026-01-01T12:00:00'))).toBe('3ヶ月前');
  });

  it('returns years for 365+ days', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2028-01-01T12:00:00'));
    expect(formatDistanceToNow(new Date('2026-01-01T12:00:00'))).toBe('2年前');
  });

  describe('locale="en" 明示指定', () => {
    it('60秒未満は "just now" を返すこと', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-01-01T12:00:30'));
      expect(formatDistanceToNow(new Date('2026-01-01T12:00:00'), 'en')).toBe('just now');
    });

    it('60分未満は "Nm ago" を返すこと', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-01-01T12:05:00'));
      expect(formatDistanceToNow(new Date('2026-01-01T12:00:00'), 'en')).toBe('5m ago');
    });

    it('24時間未満は "Nh ago" を返すこと', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-01-01T15:00:00'));
      expect(formatDistanceToNow(new Date('2026-01-01T12:00:00'), 'en')).toBe('3h ago');
    });

    it('30日未満は "Nd ago" を返すこと', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-01-08T12:00:00'));
      expect(formatDistanceToNow(new Date('2026-01-01T12:00:00'), 'en')).toBe('7d ago');
    });

    it('12ヶ月未満は "Nmo ago" を返すこと', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-04-01T12:00:00'));
      expect(formatDistanceToNow(new Date('2026-01-01T12:00:00'), 'en')).toBe('3mo ago');
    });

    it('365日以上は "Ny ago" を返すこと', () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2028-01-01T12:00:00'));
      expect(formatDistanceToNow(new Date('2026-01-01T12:00:00'), 'en')).toBe('2y ago');
    });
  });
});

describe('formatDate', () => {
  it('formats short as MM/DD', () => {
    expect(formatDate(new Date(2026, 0, 5), 'short')).toBe('01/05');
  });

  it('formats medium as YYYY/MM/DD (default)', () => {
    expect(formatDate(new Date(2026, 0, 5))).toBe('2026/01/05');
  });

  it('accepts string input', () => {
    expect(formatDate('2026-03-15', 'medium')).toMatch(/2026\/03\/15/);
  });
});

describe('formatDateTime', () => {
  it('formats as yyyy/mm/dd HH:mm:ss with zero padding', () => {
    expect(formatDateTime(new Date(2026, 8, 5, 2, 5, 7))).toBe('2026/09/05 02:05:07');
  });

  it('accepts an ISO string', () => {
    expect(formatDateTime('2026-01-05T14:30:00')).toBe('2026/01/05 14:30:00');
  });

  it('returns an empty string for an invalid date', () => {
    expect(formatDateTime(new Date('not-a-date'))).toBe('');
    expect(formatDateTime('not-a-date')).toBe('');
  });
});

describe('formatTime', () => {
  it('formats as HH:mm with zero padding', () => {
    expect(formatTime(new Date(2026, 0, 5, 9, 5))).toBe('09:05');
  });

  it('accepts an ISO string', () => {
    expect(formatTime('2026-01-05T14:30:00')).toBe('14:30');
  });

  it('returns an empty string for an invalid date', () => {
    expect(formatTime(new Date('not-a-date'))).toBe('');
    expect(formatTime('not-a-date')).toBe('');
  });
});
