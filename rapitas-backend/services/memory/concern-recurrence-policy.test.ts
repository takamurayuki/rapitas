/**
 * concern-recurrence-policy.test
 *
 * Tests for the opt-in recurrence/occurrence aggregation used by
 * self-detection and log-health filings (task #801). resolveRecurrence and
 * resolveFiling take the Prisma client as a parameter, so these tests use a
 * plain in-memory fake instead of bun's process-global mock.module.
 */
import { describe, it, expect, mock } from 'bun:test';
import {
  resolveRecurrence,
  resolveFiling,
  appendOccurrence,
  bumpSeverity,
  annotateRecurrenceOfDone,
  RECURRENCE_WINDOW_DAYS,
  type RecurrencePrisma,
  type RecurrenceCandidateEntry,
} from './concern-recurrence-policy';

const DAY_MS = 24 * 60 * 60 * 1000;

function fakePrisma(opts: {
  rows?: RecurrenceCandidateEntry[];
  task?: { status: string; completedAt: Date | null } | null;
  findManyThrows?: boolean;
}): RecurrencePrisma & { update: ReturnType<typeof mock> } {
  const update = mock(() => Promise.resolve({}));
  return {
    knowledgeEntry: {
      findMany: () => {
        if (opts.findManyThrows) return Promise.reject(new Error('db down'));
        return Promise.resolve(opts.rows ?? []);
      },
      update,
    },
    task: {
      findUnique: () => Promise.resolve(opts.task ?? null),
    },
    update,
  };
}

// ─── resolveRecurrence ──────────────────────────────────────────────────────

describe('resolveRecurrence', () => {
  it('returns "new" when no matching row exists', async () => {
    const prisma = fakePrisma({ rows: [] });
    const result = await resolveRecurrence(prisma, 'hash1', RECURRENCE_WINDOW_DAYS);
    expect(result.action).toBe('new');
  });

  it('merges into an open row', async () => {
    const row = { id: 5, sourceId: 'open', tags: '[]', content: 'detail' };
    const prisma = fakePrisma({ rows: [row] });
    const result = await resolveRecurrence(prisma, 'hash1', RECURRENCE_WINDOW_DAYS);
    expect(result).toEqual({ action: 'merged-open', targetEntry: row });
  });

  it('merges into a dismissed row (respects the explicit dismiss)', async () => {
    const row = { id: 5, sourceId: 'dismissed', tags: '[]', content: 'detail' };
    const prisma = fakePrisma({ rows: [row] });
    const result = await resolveRecurrence(prisma, 'hash1', RECURRENCE_WINDOW_DAYS);
    expect(result.action).toBe('merged-open');
  });

  it('merges into a task_created row whose task is still in flight', async () => {
    const row = { id: 5, sourceId: 'task_9', tags: '[]', content: 'detail' };
    const prisma = fakePrisma({ rows: [row], task: { status: 'in-progress', completedAt: null } });
    const result = await resolveRecurrence(prisma, 'hash1', RECURRENCE_WINDOW_DAYS);
    expect(result.action).toBe('merged-open');
  });

  it('is a recurrence-of-done when the follow-up task completed within the window (13 days)', async () => {
    const row = { id: 5, sourceId: 'task_9', tags: '[]', content: 'detail' };
    const nowMs = Date.now();
    const completedAt = new Date(nowMs - 13 * DAY_MS);
    const prisma = fakePrisma({ rows: [row], task: { status: 'done', completedAt } });
    const result = await resolveRecurrence(prisma, 'hash1', RECURRENCE_WINDOW_DAYS, nowMs);
    expect(result).toEqual({ action: 'recurrence-of-done', targetEntry: row });
  });

  it('is "new" when the follow-up task completed outside the window (15 days)', async () => {
    const row = { id: 5, sourceId: 'task_9', tags: '[]', content: 'detail' };
    const nowMs = Date.now();
    const completedAt = new Date(nowMs - 15 * DAY_MS);
    const prisma = fakePrisma({ rows: [row], task: { status: 'done', completedAt } });
    const result = await resolveRecurrence(prisma, 'hash1', RECURRENCE_WINDOW_DAYS, nowMs);
    expect(result.action).toBe('new');
  });

  it('is "new" when the terminal task has no completedAt recorded', async () => {
    const row = { id: 5, sourceId: 'task_9', tags: '[]', content: 'detail' };
    const prisma = fakePrisma({ rows: [row], task: { status: 'done', completedAt: null } });
    const result = await resolveRecurrence(prisma, 'hash1', RECURRENCE_WINDOW_DAYS);
    expect(result.action).toBe('new');
  });

  it('fails open to "new" when the DB query throws', async () => {
    const prisma = fakePrisma({ findManyThrows: true });
    const result = await resolveRecurrence(prisma, 'hash1', RECURRENCE_WINDOW_DAYS);
    expect(result.action).toBe('new');
  });
});

// ─── appendOccurrence ───────────────────────────────────────────────────────

describe('appendOccurrence', () => {
  it('adds an occurrence:2 tag on the first merge, preserving other tags', () => {
    const entry = { tags: JSON.stringify(['severity:high', 'source:agent']), content: '本文' };
    const result = appendOccurrence(entry, 'taskId:9', Date.parse('2026-08-31T00:00:00.000Z'));
    const tags = JSON.parse(result.tags) as string[];
    expect(tags).toContain('severity:high');
    expect(tags).toContain('source:agent');
    expect(tags).toContain('occurrence:2');
  });

  it('increments an existing occurrence tag instead of duplicating it', () => {
    const entry = { tags: JSON.stringify(['occurrence:3']), content: '本文' };
    const result = appendOccurrence(entry, 'taskId:9', Date.now());
    const tags = JSON.parse(result.tags) as string[];
    expect(tags).toEqual(['occurrence:4']);
  });

  it('appends a 発生記録 record line carrying the instance value', () => {
    const entry = { tags: '[]', content: '本文' };
    const result = appendOccurrence(entry, 'taskId:9', Date.parse('2026-08-31T00:00:00.000Z'));
    expect(result.content).toContain('### 発生記録');
    expect(result.content).toContain('instanceValue: taskId:9');
  });
});

// ─── bumpSeverity ───────────────────────────────────────────────────────────

describe('bumpSeverity', () => {
  it.each([
    ['low', 'medium'],
    ['medium', 'high'],
    ['high', 'high'],
    ['urgent', 'urgent'],
  ] as const)('escalates %s to %s', (current, expected) => {
    expect(bumpSeverity(current)).toBe(expected);
  });
});

// ─── annotateRecurrenceOfDone ───────────────────────────────────────────────

describe('annotateRecurrenceOfDone', () => {
  it('appends a 再発 note and returns a recurrenceOf tag', () => {
    const result = annotateRecurrenceOfDone('元の詳細', 42, Date.now());
    expect(result.content).toContain('### 再発');
    expect(result.content).toContain('#42');
    expect(result.extraTag).toBe('recurrenceOf:42');
  });
});

// ─── resolveFiling ──────────────────────────────────────────────────────────

describe('resolveFiling', () => {
  it('defers to findBlockingDuplicate when no recurrencePolicy is given', async () => {
    const prisma = fakePrisma({});
    const findBlockingDuplicate = mock(() => Promise.resolve(7));
    const decision = await resolveFiling(prisma, {
      input: { detail: '詳細' },
      hash: 'h',
      severity: 'medium',
      findBlockingDuplicate,
    });
    expect(findBlockingDuplicate).toHaveBeenCalledTimes(1);
    expect(decision).toEqual({ reuseId: 7 });
  });

  it('returns no reuseId when findBlockingDuplicate finds nothing and no policy is given', async () => {
    const prisma = fakePrisma({});
    const findBlockingDuplicate = mock(() => Promise.resolve(null));
    const decision = await resolveFiling(prisma, {
      input: { detail: '詳細' },
      hash: 'h',
      severity: 'medium',
      findBlockingDuplicate,
    });
    expect(decision).toEqual({});
  });

  it('merges into an open duplicate and updates it in place when the policy is enabled', async () => {
    const row = { id: 5, sourceId: 'open', tags: '[]', content: '既存の詳細' };
    const prisma = fakePrisma({ rows: [row] });
    const findBlockingDuplicate = mock(() => Promise.resolve(null));
    const decision = await resolveFiling(prisma, {
      input: { detail: '詳細', recurrencePolicy: { enabled: true, instanceValue: 'taskId:1' } },
      hash: 'h',
      severity: 'medium',
      findBlockingDuplicate,
    });
    expect(decision).toEqual({ reuseId: 5 });
    expect(prisma.update).toHaveBeenCalledTimes(1);
    expect(findBlockingDuplicate).not.toHaveBeenCalled();
  });

  it('escalates severity and annotates a fresh entry for a done-task recurrence', async () => {
    const row = { id: 5, sourceId: 'task_9', tags: '[]', content: '既存の詳細' };
    const nowMs = Date.now();
    const completedAt = new Date(nowMs - 1 * DAY_MS);
    const prisma = fakePrisma({ rows: [row], task: { status: 'done', completedAt } });
    const findBlockingDuplicate = mock(() => Promise.resolve(null));
    const decision = await resolveFiling(prisma, {
      input: {
        detail: '新しい詳細',
        recurrencePolicy: { enabled: true, instanceValue: 'taskId:2', detectedAt: nowMs },
      },
      hash: 'h',
      severity: 'medium',
      findBlockingDuplicate,
    });
    expect(decision.reuseId).toBeUndefined();
    expect(decision.severity).toBe('high');
    expect(decision.extraTag).toBe('recurrenceOf:5');
    expect(decision.detail).toContain('### 再発');
  });

  it('returns no adjustments when the policy is enabled but nothing matches (genuinely new)', async () => {
    const prisma = fakePrisma({ rows: [] });
    const findBlockingDuplicate = mock(() => Promise.resolve(null));
    const decision = await resolveFiling(prisma, {
      input: { detail: '詳細', recurrencePolicy: { enabled: true, instanceValue: 'taskId:3' } },
      hash: 'h',
      severity: 'low',
      findBlockingDuplicate,
    });
    expect(decision).toEqual({});
  });
});
