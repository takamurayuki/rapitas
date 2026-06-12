/**
 * log-health-check.test
 *
 * Unit tests for the grouping/normalization core (groupEntries) and the
 * level→severity mapping. File I/O and concern filing are covered elsewhere.
 */
import { describe, it, expect } from 'bun:test';
import { groupEntries, levelToSeverity } from './log-health-check';
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
