/**
 * GlobalErrorReporter.test.tsx
 *
 * Unit tests for the benign-error filter (isBenign / BENIGN_ERROR_PATTERNS /
 * matchesPattern) and the suppression behaviour inside send().
 */

import { isBenign, BENIGN_ERROR_PATTERNS } from './GlobalErrorReporter';
import { matchesPattern } from '@/config/benign-error-patterns';
import type { BenignErrorPattern } from '@/config/benign-error-patterns';

// ---------------------------------------------------------------------------
// BENIGN_ERROR_PATTERNS structural invariants
// ---------------------------------------------------------------------------

describe('BENIGN_ERROR_PATTERNS', () => {
  it('contains at least one entry', () => {
    expect(BENIGN_ERROR_PATTERNS.length).toBeGreaterThan(0);
  });

  it('every entry has a non-empty pattern string', () => {
    for (const entry of BENIGN_ERROR_PATTERNS) {
      expect(typeof entry.pattern).toBe('string');
      expect(entry.pattern.length).toBeGreaterThan(0);
    }
  });

  it('every entry has a non-empty note string', () => {
    for (const entry of BENIGN_ERROR_PATTERNS) {
      expect(typeof entry.note).toBe('string');
      expect(entry.note.length).toBeGreaterThan(0);
    }
  });

  it('no duplicate patterns', () => {
    const patterns = BENIGN_ERROR_PATTERNS.map((e) => e.pattern);
    const unique = new Set(patterns);
    expect(unique.size).toBe(patterns.length);
  });
});

// ---------------------------------------------------------------------------
// matchesPattern() — core matching logic
// ---------------------------------------------------------------------------

describe('matchesPattern()', () => {
  const prefixEntry: BenignErrorPattern = {
    pattern: 'ResizeObserver loop limit exceeded',
    note: 'test',
  };
  const containsEntry: BenignErrorPattern = {
    pattern: 'chunk load error',
    mode: 'contains',
    note: 'test',
  };
  const uaEntry: BenignErrorPattern = {
    pattern: 'WebGL: INVALID_OPERATION',
    ua: 'Firefox',
    note: 'test',
  };
  const envEntry: BenignErrorPattern = {
    pattern: 'HMR connection lost',
    env: ['development'],
    note: 'test',
  };

  describe('prefix mode (default)', () => {
    it('matches when message starts with pattern', () => {
      expect(matchesPattern(prefixEntry, 'ResizeObserver loop limit exceeded — details')).toBe(
        true,
      );
    });

    it('matches exact prefix', () => {
      expect(matchesPattern(prefixEntry, 'ResizeObserver loop limit exceeded')).toBe(true);
    });

    it('returns false when message does not start with pattern', () => {
      expect(matchesPattern(prefixEntry, 'Caught: ResizeObserver loop limit exceeded')).toBe(false);
    });
  });

  describe('contains mode', () => {
    it('matches when pattern appears anywhere in the message', () => {
      expect(matchesPattern(containsEntry, 'Loading chunk load error occurred')).toBe(true);
    });

    it('returns false when pattern is absent', () => {
      expect(matchesPattern(containsEntry, 'unrelated error')).toBe(false);
    });
  });

  describe('ctx absent — backward-compatible path', () => {
    it('skips UA/env constraints when ctx is undefined', () => {
      expect(matchesPattern(uaEntry, 'WebGL: INVALID_OPERATION', undefined)).toBe(true);
      expect(matchesPattern(envEntry, 'HMR connection lost', undefined)).toBe(true);
    });
  });

  describe('UA filtering', () => {
    it('suppresses when ua matches', () => {
      expect(
        matchesPattern(uaEntry, 'WebGL: INVALID_OPERATION', { ua: 'Mozilla/Firefox/129' }),
      ).toBe(true);
    });

    it('passes through on non-matching UA', () => {
      expect(
        matchesPattern(uaEntry, 'WebGL: INVALID_OPERATION', { ua: 'Chrome/124' }),
      ).toBe(false);
    });

    it('skips UA constraint when ctx.ua is undefined (navigator absent)', () => {
      expect(matchesPattern(uaEntry, 'WebGL: INVALID_OPERATION', { ua: undefined })).toBe(true);
    });
  });

  describe('env filtering', () => {
    it('suppresses in matching environment', () => {
      expect(matchesPattern(envEntry, 'HMR connection lost', { env: 'development' })).toBe(true);
    });

    it('passes through in non-matching environment', () => {
      expect(matchesPattern(envEntry, 'HMR connection lost', { env: 'production' })).toBe(false);
    });

    it('skips env constraint when ctx.env is undefined', () => {
      expect(matchesPattern(envEntry, 'HMR connection lost', { env: undefined })).toBe(true);
    });
  });

  describe('boundary cases', () => {
    it('returns false for empty message', () => {
      expect(matchesPattern(prefixEntry, '')).toBe(false);
    });

    it('returns false when pattern is longer than message', () => {
      expect(matchesPattern(prefixEntry, 'ResizeObserver')).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// isBenign() — backward-compatible API
// ---------------------------------------------------------------------------

describe('isBenign()', () => {
  it.each(BENIGN_ERROR_PATTERNS.map((e) => e.pattern))(
    'returns true for exact match of built-in pattern: %s',
    (pattern) => {
      expect(isBenign(pattern)).toBe(true);
    },
  );

  it('returns true when message starts with a built-in prefix (with trailing detail)', () => {
    expect(isBenign('ResizeObserver loop limit exceeded — extra detail')).toBe(true);
    expect(isBenign('Script error. (from cdn.example.com)')).toBe(true);
  });

  it('returns false for a real application error', () => {
    expect(isBenign('Cannot read properties of undefined (reading "id")')).toBe(false);
    expect(isBenign('Unhandled promise rejection: 401 Unauthorized')).toBe(false);
    expect(isBenign('TypeError: null is not an object')).toBe(false);
  });

  it('is case-sensitive — wrong casing does not match', () => {
    // NOTE: Case-sensitive matching is intentional — see docs/design/global-error-reporter-filter.md.
    expect(isBenign('resizeobserver loop limit exceeded')).toBe(false);
    expect(isBenign('SCRIPT ERROR.')).toBe(false);
  });

  it('returns false for an empty string', () => {
    expect(isBenign('')).toBe(false);
  });

  it('returns false when message only partially overlaps but does not start with the prefix', () => {
    expect(isBenign('Caught: ResizeObserver loop limit exceeded')).toBe(false);
  });

  describe('with ctx — UA/env aware path', () => {
    it('still suppresses built-in patterns when ctx is provided (no ua/env on those entries)', () => {
      expect(
        isBenign('ResizeObserver loop limit exceeded', {
          ua: 'Mozilla/5.0 (Windows NT 10.0) Chrome/124',
          env: 'production',
        }),
      ).toBe(true);
    });

    it('skips UA constraint for built-in entries (ua field absent on entry)', () => {
      // Built-in entries have no ua — they are valid for all browsers.
      expect(
        isBenign('Script error.', { ua: 'some-unusual-ua-string', env: 'production' }),
      ).toBe(true);
    });
  });
});
