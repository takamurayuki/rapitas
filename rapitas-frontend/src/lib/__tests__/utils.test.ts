import { cn, toDateLocale, formatDate, formatDateTime, formatTime } from '../utils';

describe('cn', () => {
  it('joins multiple class names', () => {
    expect(cn('foo', 'bar', 'baz')).toBe('foo bar baz');
  });

  it('filters out falsy values', () => {
    expect(cn('a', undefined, 'b', null, 'c', false)).toBe('a b c');
  });

  it('returns empty string when no arguments', () => {
    expect(cn()).toBe('');
  });

  it('returns empty string when all values are falsy', () => {
    expect(cn(undefined, null, false)).toBe('');
  });

  it('handles single class name', () => {
    expect(cn('only')).toBe('only');
  });

  it('handles empty strings by filtering them out', () => {
    expect(cn('a', '', 'b')).toBe('a b');
  });
});

describe('toDateLocale', () => {
  it('maps "ja" to "ja-JP"', () => {
    expect(toDateLocale('ja')).toBe('ja-JP');
  });

  it('maps "en" to "en-US"', () => {
    expect(toDateLocale('en')).toBe('en-US');
  });

  it('falls back to "ja-JP" for an unrecognized locale', () => {
    expect(toDateLocale('fr')).toBe('ja-JP');
    expect(toDateLocale('')).toBe('ja-JP');
  });
});

describe('formatDate', () => {
  it('formats a Date object using the locale-mapped Intl formatter', () => {
    const date = new Date(Date.UTC(2026, 0, 15));
    expect(formatDate(date, 'en')).toBe(date.toLocaleDateString('en-US'));
  });

  it('accepts an ISO string and parses it before formatting', () => {
    const iso = '2026-01-15T00:00:00.000Z';
    expect(formatDate(iso, 'ja')).toBe(new Date(iso).toLocaleDateString('ja-JP'));
  });

  it('passes through Intl.DateTimeFormatOptions', () => {
    const date = new Date(Date.UTC(2026, 5, 1));
    const options: Intl.DateTimeFormatOptions = { year: 'numeric' };
    expect(formatDate(date, 'en', options)).toBe(date.toLocaleDateString('en-US', options));
  });
});

describe('formatDateTime', () => {
  it('formats a Date object as a locale-mapped date-time string', () => {
    const date = new Date(Date.UTC(2026, 0, 15, 9, 30));
    expect(formatDateTime(date, 'en')).toBe(date.toLocaleString('en-US'));
  });

  it('accepts an ISO string', () => {
    const iso = '2026-01-15T09:30:00.000Z';
    expect(formatDateTime(iso, 'ja')).toBe(new Date(iso).toLocaleString('ja-JP'));
  });
});

describe('formatTime', () => {
  it('formats a Date object as a locale-mapped time string', () => {
    const date = new Date(Date.UTC(2026, 0, 15, 14, 45));
    expect(formatTime(date, 'en')).toBe(date.toLocaleTimeString('en-US'));
  });

  it('accepts an ISO string', () => {
    const iso = '2026-01-15T14:45:00.000Z';
    expect(formatTime(iso, 'ja')).toBe(new Date(iso).toLocaleTimeString('ja-JP'));
  });
});
