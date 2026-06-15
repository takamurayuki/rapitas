/**
 * error-analytics-service.test.ts
 *
 * Unit tests for the error analytics service's parsing, classification, and
 * aggregation logic. File I/O is mocked — these tests never touch the real
 * log directory.
 */

import { describe, it, expect, mock } from 'bun:test';
import {
  parsePinoLine,
  isBenign,
  classifyMessage,
  computeDeltaPercent,
  stampForDaysAgo,
} from '../../services/system/error-analytics-service';

// ---- parsePinoLine ----------------------------------------------------------

describe('parsePinoLine', () => {
  it('parses a valid error line', () => {
    const raw = JSON.stringify({ level: 50, time: 1700000000000, msg: 'gh command failed', name: 'gh-client' });
    const result = parsePinoLine(raw);
    expect(result).not.toBeNull();
    expect(result!.level).toBe(50);
    expect(result!.msg).toBe('gh command failed');
    expect(result!.name).toBe('gh-client');
  });

  it('parses a warn line', () => {
    const raw = JSON.stringify({ level: 40, time: 1700000000000, msg: 'Worker not ready' });
    const result = parsePinoLine(raw);
    expect(result).not.toBeNull();
    expect(result!.level).toBe(40);
  });

  it('returns null for an info-level line (level < 40)', () => {
    const raw = JSON.stringify({ level: 30, time: 1700000000000, msg: 'HTTP request handled' });
    expect(parsePinoLine(raw)).toBeNull();
  });

  it('returns null for invalid JSON', () => {
    expect(parsePinoLine('not json')).toBeNull();
    expect(parsePinoLine('{broken:')).toBeNull();
  });

  it('returns null for an empty string', () => {
    expect(parsePinoLine('')).toBeNull();
  });

  it('coerces missing msg to empty string', () => {
    const raw = JSON.stringify({ level: 50, time: 1700000000000 });
    const result = parsePinoLine(raw);
    expect(result).not.toBeNull();
    expect(result!.msg).toBe('');
  });
});

// ---- isBenign ---------------------------------------------------------------

describe('isBenign', () => {
  it('suppresses known-benign rollout failure messages', () => {
    expect(isBenign('codex_core::session: failed to record rollout')).toBe(true);
    expect(isBenign('failed to record rollout')).toBe(true);
  });

  it('suppresses stale temp dir cleanup failures', () => {
    expect(isBenign('failed to clean up stale arg0 temp dirs')).toBe(true);
  });

  it('suppresses PATH update warnings', () => {
    expect(isBenign('proceeding, even though we could not update PATH')).toBe(true);
  });

  it('does not suppress real errors', () => {
    expect(isBenign('gh command failed: gh pr list')).toBe(false);
    expect(isBenign('Worker not ready')).toBe(false);
    expect(isBenign('JSON parse failed')).toBe(false);
  });
});

// ---- classifyMessage --------------------------------------------------------

describe('classifyMessage', () => {
  const cases: [string, string][] = [
    ['gh command failed: gh pr list', 'GH_CLI'],
    ['gh: error (HTTP 404)', 'GH_CLI'],
    ['Worker not ready', 'WORKER'],
    ['Startup recovery skipped: Worker not ready after 20s', 'WORKER'],
    ['Retrospective JSON parse failed; returning raw content', 'JSON_PARSE'],
    ['codex debug models JSON parse failed', 'JSON_PARSE'],
    ['P2002 Prisma Error: Unique constraint failed', 'DATABASE'],
    ['ECONNREFUSED 127.0.0.1:5432', 'DATABASE'],
    ['ECONNREFUSED 127.0.0.1:3000', 'NETWORK'],
    ['ENOTFOUND api.github.com', 'NETWORK'],
    ['Failed to fetch user data', 'NETWORK'],
    ['rate limit exceeded on Claude API', 'RATE_LIMIT'],
    ['429 Too Many Requests', 'RATE_LIMIT'],
    ['Unauthorized: invalid session token', 'AUTH'],
    ['auth failed for user admin', 'AUTH'],
    ['Operation timed out after 30s', 'TIMEOUT'],
    ['ETIMEDOUT connecting to server', 'TIMEOUT'],
    ['Some unknown weird error with no pattern', 'UNCLASSIFIED'],
  ];

  for (const [msg, expected] of cases) {
    it(`classifies "${msg.slice(0, 40)}..." as ${expected}`, () => {
      expect(classifyMessage(msg)).toBe(expected);
    });
  }
});

// ---- computeDeltaPercent ----------------------------------------------------

describe('computeDeltaPercent', () => {
  it('returns null when previous is 0', () => {
    expect(computeDeltaPercent(5, 0)).toBeNull();
    expect(computeDeltaPercent(0, 0)).toBeNull();
  });

  it('computes positive growth correctly', () => {
    expect(computeDeltaPercent(5, 2)).toBe(150);
  });

  it('computes decline correctly', () => {
    expect(computeDeltaPercent(1, 4)).toBe(-75);
  });

  it('returns 0 for no change', () => {
    expect(computeDeltaPercent(3, 3)).toBe(0);
  });

  it('handles large values without overflow', () => {
    const result = computeDeltaPercent(1000, 500);
    expect(result).toBe(100);
  });
});

// ---- stampForDaysAgo --------------------------------------------------------

describe('stampForDaysAgo', () => {
  it('returns a YYYY-MM-DD string', () => {
    const stamp = stampForDaysAgo(0);
    expect(/^\d{4}-\d{2}-\d{2}$/.test(stamp)).toBe(true);
  });

  it('returns a date that is in the past for daysAgo > 0', () => {
    const today = stampForDaysAgo(0);
    const yesterday = stampForDaysAgo(1);
    expect(yesterday < today).toBe(true);
  });
});
