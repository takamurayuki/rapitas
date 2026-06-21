/**
 * log-health-check.test
 *
 * Unit tests for the grouping/normalization core (groupEntries), the
 * level→severity mapping, and the async differential readGlobalEntries.
 */
import { describe, it, expect, afterEach } from 'bun:test';
import { writeFileSync, unlinkSync, existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { groupEntries, levelToSeverity, readGlobalEntries } from './log-health-check';
import type { ParsedLogEntry } from './log-format-parser';

function entry(over: Partial<ParsedLogEntry> & { level: number; msg: string }): ParsedLogEntry {
  return { ...over };
}

describe('groupEntries', () => {
  it('coalesces messages that differ only by numbers/ids', () => {
    const groups = groupEntries([
      entry({ level: 50, name: 'task', msg: 'task 12 failed' }),
      entry({ level: 50, name: 'task', msg: 'task 345 failed' }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].count).toBe(2);
    expect(groups[0].normalizedMsg).toBe('task # failed');
  });

  it('separates warnings from errors even with the same text', () => {
    const groups = groupEntries([
      entry({ level: 40, name: 'db', msg: 'slow query' }),
      entry({ level: 50, name: 'db', msg: 'slow query' }),
    ]);
    expect(groups).toHaveLength(2);
  });

  it('separates different loggers', () => {
    const groups = groupEntries([
      entry({ level: 50, name: 'a', msg: 'boom' }),
      entry({ level: 50, name: 'b', msg: 'boom' }),
    ]);
    expect(groups).toHaveLength(2);
  });

  it('keeps the highest level and a sample stack for a signature', () => {
    const groups = groupEntries([
      entry({ level: 50, name: 'x', msg: 'oops', stack: 'at foo()' }),
      entry({ level: 50, name: 'x', msg: 'oops' }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].sampleStack).toBe('at foo()');
  });

  it('skips sub-warn entries', () => {
    const groups = groupEntries([
      entry({ level: 30, name: 'x', msg: 'info noise' }),
      entry({ level: 50, name: 'x', msg: 'kept' }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].normalizedMsg).toBe('kept');
  });
});

describe('levelToSeverity', () => {
  it('maps levels to concern severities', () => {
    expect(levelToSeverity(40)).toBe('medium'); // warn
    expect(levelToSeverity(50)).toBe('high'); // error
    expect(levelToSeverity(60)).toBe('urgent'); // fatal
  });
});

describe('readGlobalEntries', () => {
  const tmpFiles: string[] = [];

  function writeTmp(name: string, content: string): string {
    const p = join(tmpdir(), name);
    writeFileSync(p, content, 'utf-8');
    tmpFiles.push(p);
    return p;
  }

  afterEach(() => {
    for (const p of tmpFiles.splice(0)) {
      if (existsSync(p)) unlinkSync(p);
    }
  });

  it('returns [] when the file does not exist', async () => {
    const entries = await readGlobalEntries(0, join(tmpdir(), '__nonexistent_test__.log'));
    expect(entries).toEqual([]);
  });

  it('returns [] for an empty file', async () => {
    const p = writeTmp('hc-empty.log', '');
    const entries = await readGlobalEntries(0, p);
    expect(entries).toEqual([]);
  });

  it('filters out entries whose time is before sinceMs', async () => {
    const sinceMs = Date.now();
    const old = JSON.stringify({ level: 50, msg: 'old error', time: sinceMs - 5_000, name: 'x' });
    const fresh = JSON.stringify({
      level: 50,
      msg: 'fresh error',
      time: sinceMs + 5_000,
      name: 'x',
    });
    const p = writeTmp('hc-filter.log', `${old}\n${fresh}\n`);
    const entries = await readGlobalEntries(sinceMs, p);
    expect(entries.some((e) => e.msg === 'old error')).toBe(false);
    expect(entries.some((e) => e.msg === 'fresh error')).toBe(true);
  });

  it('keeps entries with no time field regardless of sinceMs', async () => {
    const p = writeTmp(
      'hc-notime.log',
      JSON.stringify({ level: 50, msg: 'no time', name: 'x' }) + '\n',
    );
    // Use a very large sinceMs to verify time-less entries are always kept.
    const entries = await readGlobalEntries(Date.now() + 999_999_999, p);
    expect(entries.some((e) => e.msg === 'no time')).toBe(true);
  });
});
