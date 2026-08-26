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

  it('coalesces the same failure carrying different session UUIDs', () => {
    // Regression: UUID middle segments used to survive normalization with a
    // per-value letter pattern, so one repeating cause filed a new concern
    // (and task) per occurrence. Both messages below are the same failure.
    const msg = (sid: string) =>
      `Claude CLI exited 1: {"is_error":true,"num_turns":1,"session_id":"${sid}","total_cost_usd":0}`;
    const groups = groupEntries([
      entry({ level: 50, name: 'cli', msg: msg('36c6ecd3-6e3b-40bd-9806-c589d4fe312e') }),
      entry({ level: 50, name: 'cli', msg: msg('53c02bc5-c392-4625-b61a-980ede07748a') }),
      entry({ level: 50, name: 'cli', msg: msg('9801899E-63E8-41C8-B7FA-BFD4873DC189') }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].count).toBe(3);
    // The whole payload now collapses rather than each id inside it. Same
    // contract, held more firmly: no field of a JSON payload can split one
    // cause into several concerns.
    expect(groups[0].normalizedMsg).toBe('Claude CLI exited #: {…}');
  });

  it('collapses a JSON payload whatever varies inside it', () => {
    // Regression 2026-08-27: four byte-identical 「Claude CLI exited」 concerns
    // sat open together because the payload differed in non-id fields, which
    // the id-level normalization could not reach.
    const groups = groupEntries([
      entry({ level: 50, name: 'cli', msg: 'Claude CLI exited 1: {"stop_reason":"max_turns"}' }),
      entry({
        level: 50,
        name: 'cli',
        msg: 'Claude CLI exited 1: {"stop_reason":"error","x":{"y":2}}',
      }),
    ]);
    expect(groups).toHaveLength(1);
  });

  it('collapses absolute paths so one defect in two worktrees is one concern', () => {
    // Regression 2026-08-27: 'setup-worktree.cjs not found at <A>' and the same
    // line with <B> were both open, as were two 'git worktree remove' failures.
    const groups = groupEntries([
      entry({
        level: 40,
        name: 'wt',
        msg: String.raw`setup-worktree.cjs not found at C:\Projects\a\.worktrees\t-1`,
      }),
      entry({
        level: 40,
        name: 'wt',
        msg: String.raw`setup-worktree.cjs not found at C:\Projects\b\.worktrees\t-2`,
      }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].normalizedMsg).toContain('<path>');
  });

  it('drops a line that reports a guard doing its job', () => {
    // The health check files what is BROKEN. A refusal prevented the problem.
    const groups = groupEntries([
      entry({
        level: 50,
        name: 'git',
        msg: 'Refusing to switch to branch x in the PRIMARY git working tree',
      }),
    ]);
    expect(groups).toHaveLength(0);
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
