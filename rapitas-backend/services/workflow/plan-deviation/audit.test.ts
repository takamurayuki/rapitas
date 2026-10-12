/**
 * audit tests — approval-time deviation summary persisted as NDJSON.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { appendDeviationAudit, buildAuditRecord, listDeviationAudits } from './audit';
import type { DeviationTimeline } from './types';

const SECRET = 'ghp_' + 'Q'.repeat(36);

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'plan-audit-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const okTimeline: DeviationTimeline = {
  status: 'ok',
  entries: [],
  counts: { inPlan: 3, outOfPlan: 2, plannedNotExecuted: 1 },
  byKind: { file_change: 1, command: 1, http: 1 },
  warnings: [],
  planHash: 'abcdef0123456789',
};

describe('deviation audit', () => {
  test('saves counts, kinds and the masked comment; reads it back', () => {
    const record = buildAuditRecord({
      taskId: 5,
      executionId: 11,
      decision: 'approved',
      comment: `計画外の rm は意図的。token=${SECRET}`,
      source: 'ui',
      timeline: okTimeline,
    });
    appendDeviationAudit(record, dir);
    const raw = readFileSync(join(dir, 'plan-deviation-audit', '5.ndjson'), 'utf-8');
    expect(raw).not.toContain(SECRET);

    const [saved] = listDeviationAudits(5, dir);
    expect(saved.taskId).toBe(5);
    expect(saved.executionId).toBe(11);
    expect(saved.decision).toBe('approved');
    expect(saved.counts).toEqual({ inPlan: 3, outOfPlan: 2, plannedNotExecuted: 1 });
    expect(saved.byKind).toEqual({ file_change: 1, command: 1, http: 1 });
    expect(saved.ambiguous).toBe(false);
    expect(saved.commentMasked).toContain('計画外の rm は意図的');
    expect(saved.commentMasked).toContain('[REDACTED]');
    expect(saved.planHash).toBe('abcdef0123456789');
    expect(saved.source).toBe('ui');
    expect(typeof saved.recordedAt).toBe('string');
  });

  test('ambiguous timelines record null counts', () => {
    const record = buildAuditRecord({
      taskId: 6,
      decision: 'approved',
      source: 'operator',
      timeline: { ...okTimeline, status: 'ambiguous', counts: null, byKind: null },
    });
    expect(record.ambiguous).toBe(true);
    expect(record.counts).toBeNull();
    expect(record.byKind).toBeNull();
    expect(record.commentMasked).toBeNull();
    expect(record.executionId).toBeNull();
  });

  test('records are appended, never overwritten', () => {
    const base = { taskId: 7, decision: 'approved' as const, source: 'ui', timeline: okTimeline };
    appendDeviationAudit(buildAuditRecord({ ...base, comment: 'first' }), dir);
    appendDeviationAudit(buildAuditRecord({ ...base, decision: 'rejected', comment: 'second' }), dir);
    expect(listDeviationAudits(7, dir).map((r) => r.commentMasked)).toEqual(['first', 'second']);
    expect(listDeviationAudits(8, dir)).toEqual([]);
  });

  test('over-long comments are truncated', () => {
    const r = buildAuditRecord({ taskId: 1, decision: 'approved', source: 'ui', comment: 'x'.repeat(5000), timeline: okTimeline });
    expect(r.commentMasked!.length).toBeLessThanOrEqual(2001);
  });
});
