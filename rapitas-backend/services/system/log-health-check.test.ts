/**
 * log-health-check.test
 *
 * Unit tests for the log grouping/normalization core (groupLogLines) and the
 * level→severity mapping. File I/O and concern filing are covered elsewhere.
 */
import { describe, it, expect } from 'bun:test';
import { groupLogLines, levelToSeverity } from './log-health-check';

function line(o: Record<string, unknown>): string {
  return JSON.stringify(o);
}

describe('groupLogLines', () => {
  it('coalesces messages that differ only by numbers/ids', () => {
    const groups = groupLogLines([
      line({ level: 50, name: 'task', msg: 'task 12 failed' }),
      line({ level: 50, name: 'task', msg: 'task 345 failed' }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].count).toBe(2);
    expect(groups[0].normalizedMsg).toBe('task # failed');
  });

  it('separates warnings from errors even with the same text', () => {
    const groups = groupLogLines([
      line({ level: 40, name: 'db', msg: 'slow query' }),
      line({ level: 50, name: 'db', msg: 'slow query' }),
    ]);
    expect(groups).toHaveLength(2);
  });

  it('separates different loggers', () => {
    const groups = groupLogLines([
      line({ level: 50, name: 'a', msg: 'boom' }),
      line({ level: 50, name: 'b', msg: 'boom' }),
    ]);
    expect(groups).toHaveLength(2);
  });

  it('keeps the highest level and a sample stack for a signature', () => {
    const groups = groupLogLines([
      line({ level: 40, name: 'x', msg: 'oops' }),
      line({ level: 50, name: 'x', msg: 'oops', err: { message: 'oops', stack: 'at foo()' } }),
    ]);
    // warn 'oops' and error 'oops' are different buckets → 2 groups; the error
    // group should carry the stack.
    const errGroup = groups.find((g) => g.level === 50);
    expect(errGroup?.sampleStack).toBe('at foo()');
  });

  it('prefers err.message over msg for the signature', () => {
    const groups = groupLogLines([
      line({ level: 50, name: 'x', msg: 'generic', err: { message: 'real cause 7' } }),
    ]);
    expect(groups[0].normalizedMsg).toBe('real cause #');
  });

  it('skips non-JSON and sub-warn lines', () => {
    const groups = groupLogLines([
      'not json',
      line({ level: 30, name: 'x', msg: 'info noise' }),
      line({ level: 50, name: 'x', msg: 'kept' }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].normalizedMsg).toBe('kept');
  });
});

describe('levelToSeverity', () => {
  it('maps pino levels to concern severities', () => {
    expect(levelToSeverity(40)).toBe('medium'); // warn
    expect(levelToSeverity(50)).toBe('high'); // error
    expect(levelToSeverity(60)).toBe('urgent'); // fatal
  });
});
