import { describe, it, expect, vi, afterEach } from 'vitest';
import { formatDistanceToNow, formatDate } from '../date';

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
});

describe('formatDate', () => {
  it('formats short as MM/DD', () => {
    expect(formatDate(new Date(2026, 0, 5), 'short')).toBe('01/05');
  });

  it('formats medium as YYYY/MM/DD (default)', () => {
    expect(formatDate(new Date(2026, 0, 5))).toBe('2026/01/05');
  });

  it('formats long with time', () => {
    const result = formatDate(new Date(2026, 0, 5, 14, 30), 'long');
    expect(result).toBe('2026年01月05日 14:30');
  });

  it('accepts string input', () => {
    expect(formatDate('2026-03-15', 'medium')).toMatch(/2026\/03\/15/);
  });
});
