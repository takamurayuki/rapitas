/**
 * Tests for log-markdown-builder.
 */
import { describe, test, expect } from 'bun:test';
import { buildMarkdownLog, validateHeadingContinuity } from './log-markdown-builder';
import type { StructuredLogEntry } from './types';

const e = (
  eventType: StructuredLogEntry['eventType'],
  message: string,
  extra: Partial<StructuredLogEntry> = {},
): StructuredLogEntry => ({
  timestamp: '2026-10-15T01:00:00.000Z',
  level: 'INFO',
  eventType,
  executionId: 7,
  sessionId: 1,
  taskId: 1257,
  message,
  ...extra,
});

describe('buildMarkdownLog', () => {
  const entries = [
    e('execution_start', 'start', { context: { phase: 'implement', sequenceNumber: 41 } }),
    e('output', 'noise', { context: { phase: 'implement' } }),
    e('git_commit', 'commit\n# fake', { context: { phase: 'implement' } }),
    e('error', 'boom', { level: 'ERROR', context: { phase: 'verify' } }),
  ];
  const md = buildMarkdownLog(entries, { executionId: 7, taskTitle: 't' });
  const headings = md.split('\n').filter((l) => l.startsWith('#'));

  test('headings are continuous starting at h2', () => {
    expect(validateHeadingContinuity(md)).toEqual([]);
    expect(headings[0].startsWith('## ')).toBe(true);
  });

  test('every heading has time and status; failure is marked', () => {
    expect(headings.length).toBe(5); // 2 phases + 3 steps (output excluded)
    for (const h of headings) {
      expect(h).toContain('2026-10-15T01:00:00.000Z');
      expect(/（成功）$|（失敗）$/.test(h)).toBe(true);
    }
    expect(headings.filter((h) => h.endsWith('（失敗）')).length).toBe(2);
  });

  test('each section keeps a raw-log reference and no injected heading', () => {
    expect(md.match(/- ref: execution 7/g)?.length).toBe(5);
    expect(md).toContain('seq 41 @ 2026-10-15T01:00:00.000Z');
    expect(md).not.toMatch(/seq 1-/); // no array-index sequences
    expect(md).not.toMatch(/^# fake/m);
  });

  test('hostile titles and messages cannot inject structure', () => {
    const hostile = buildMarkdownLog([e('error', '# # x\n## y --> <!-- z', { level: 'ERROR' })], {
      executionId: 7,
      taskTitle: 'a --> \n## injected',
    });
    expect(validateHeadingContinuity(hostile)).toEqual([]);
    expect(hostile).not.toMatch(/^## injected/m);
    expect(hostile.match(/-->/g)?.length).toBe(1); // only the marker's own terminator
    expect(hostile).toContain('- message: x ## y z');
  });

  test('a failing output entry appears as a step so the failed phase has a visible cause', () => {
    const out = buildMarkdownLog([
      e('output', 'stderr: crashed', { level: 'ERROR', context: { phase: 'verify' } }),
    ]);
    const hs = out.split('\n').filter((l) => l.startsWith('#'));
    expect(hs.length).toBe(2);
    expect(hs.every((h) => h.endsWith('（失敗）'))).toBe(true);
    expect(out).toContain('- message: stderr: crashed');
  });

  test('refs use the entry own sequenceNumber, so a filtered subset keeps the original ids', () => {
    const all = [10, 11, 12].map((n) =>
      e('git_commit', `c${n}`, { context: { phase: 'implement', sequenceNumber: n } }),
    );
    const subset = buildMarkdownLog(all.filter((x) => x.context?.sequenceNumber === 12));
    expect(subset).toContain('- ref: execution 7 seq 12 @ 2026-10-15T01:00:00.000Z');
    expect(subset).toContain('seq 12-12');
    expect(subset).not.toMatch(/seq 1\b/); // array index of the subset would be 1
    const full = buildMarkdownLog(all);
    expect(full).toContain('seq 10-12');
  });

  test('hostile phase names (comment end, fences, forged status) cannot break structure', () => {
    const phase = '--> ```\n# forged（成功）';
    const out = buildMarkdownLog(
      [e('error', '```\n## fake\n```', { level: 'ERROR', context: { phase } })],
      { executionId: 7, taskTitle: '```\n<!-- x -->\n## t' },
    );
    expect(validateHeadingContinuity(out)).toEqual([]);
    const hs = out.split('\n').filter((l) => l.startsWith('#'));
    expect(hs.length).toBe(2);
    expect(hs.every((h) => h.endsWith('（失敗）') && !h.includes('（成功）'))).toBe(true);
    expect(out).not.toMatch(/^```/m);
    expect(out.split('\n')[0].match(/-->/g)?.length).toBe(1);
    expect(out.split('\n')[0].match(/<!--/g)?.length).toBe(1);
  });

  test('empty entries yield valid markdown', () => {
    expect(validateHeadingContinuity(buildMarkdownLog([]))).toEqual([]);
  });
});

describe('validateHeadingContinuity', () => {
  test('rejects skipped levels, non-h2 start and missing status', () => {
    expect(validateHeadingContinuity('## a（成功）\n#### b（成功）').length).toBe(1);
    expect(validateHeadingContinuity('### a（成功）').length).toBe(1);
    expect(validateHeadingContinuity('## a').length).toBe(1);
  });
});
