/**
 * growth-ledger-metrics.test
 *
 * Unit tests for the pure growth-ledger core: location-key normalization,
 * per-task transition grouping, and the five weekly series. The Prisma shell
 * (computeGrowthLedgerMetrics) is a thin wrapper and is not exercised here
 * (same policy as loop-metrics.test.ts).
 */
import { describe, it, expect } from 'bun:test';
import {
  normalizeConcernKey,
  groupTaskEvents,
  computeGrowthLedger,
  type GrowthTransitionRow,
  type TaskEventLite,
  type ConcernLite,
  type KbLite,
} from './growth-ledger-metrics';

const NOW = new Date('2026-08-07T00:00:00Z');
const DAY_MS = 24 * 60 * 60 * 1000;

/** Timestamp `daysAgo` days before NOW (negative = future). */
function at(daysAgo: number): Date {
  return new Date(NOW.getTime() - daysAgo * DAY_MS);
}

/** Shorthand transition row for taskId at `daysAgo`, with overrides. */
function trow(
  taskId: number,
  daysAgo: number,
  over: Partial<GrowthTransitionRow> = {},
): GrowthTransitionRow {
  return {
    taskId,
    toStatus: null,
    actor: 'system',
    cause: null,
    metadata: null,
    createdAt: at(daysAgo),
    ...over,
  };
}

/** TaskEventLite with all-neutral defaults, overridable per test. */
function taskEvent(over: Partial<TaskEventLite> = {}): TaskEventLite {
  return {
    taskId: 1,
    completedAt: null,
    hadUserActor: false,
    verifyRepairCount: 0,
    ciRepairCount: 0,
    researchSavedAt: null,
    researchBounced: false,
    planSavedAt: null,
    planBounced: false,
    ...over,
  };
}

/** Ledger input with empty defaults. */
function input(over: {
  taskEvents?: TaskEventLite[];
  concerns?: ConcernLite[];
  kbEntries?: KbLite[];
}) {
  return { taskEvents: [], concerns: [], kbEntries: [], ...over };
}

describe('normalizeConcernKey', () => {
  it('strips trailing line/column suffixes', () => {
    expect(normalizeConcernKey('src/App.tsx:42')).toBe('src/app.tsx');
    expect(normalizeConcernKey('a/b.ts:12:34')).toBe('a/b.ts');
  });

  it('trims and lowercases', () => {
    expect(normalizeConcernKey('  Services/Foo.TS  ')).toBe('services/foo.ts');
    expect(normalizeConcernKey('src/file.ts')).toBe('src/file.ts');
  });

  it('returns null for missing or empty locations', () => {
    expect(normalizeConcernKey(null)).toBeNull();
    expect(normalizeConcernKey(undefined)).toBeNull();
    expect(normalizeConcernKey('   ')).toBeNull();
    expect(normalizeConcernKey(':42')).toBeNull();
  });
});

describe('groupTaskEvents', () => {
  it('aggregates saves, bounces, user actor, repairs and completion per task', () => {
    const rows = [
      trow(1, 10, { cause: 'file_saved:research' }),
      trow(1, 9.5, { cause: 'research_critic_failed' }),
      trow(1, 9, { cause: 'file_saved:research' }),
      trow(1, 8, { cause: 'file_saved:plan' }),
      trow(1, 5, { cause: 'verify_repair' }),
      trow(1, 4, { cause: 'verify_repair' }),
      trow(1, 3, { cause: 'ci_repair' }),
      trow(1, 2, { actor: 'user', cause: 'manual_plan_approved' }),
      trow(1, 1, { toStatus: 'completed', cause: 'file_saved:verify' }),
      trow(2, 6, { cause: 'file_saved:research' }),
    ];
    const events = groupTaskEvents(rows);
    expect(events).toHaveLength(2);

    const t1 = events.find((e) => e.taskId === 1)!;
    expect(t1.completedAt).toEqual(at(1));
    expect(t1.hadUserActor).toBe(true);
    expect(t1.verifyRepairCount).toBe(2);
    expect(t1.ciRepairCount).toBe(1);
    expect(t1.researchSavedAt).toEqual(at(10)); // first save wins
    expect(t1.researchBounced).toBe(true);
    expect(t1.planSavedAt).toEqual(at(8));
    expect(t1.planBounced).toBe(false);

    const t2 = events.find((e) => e.taskId === 2)!;
    expect(t2.completedAt).toBeNull();
    expect(t2.hadUserActor).toBe(false);
    expect(t2.researchSavedAt).toEqual(at(6));
    expect(t2.researchBounced).toBe(false);
  });

  it('keeps the earliest completion when a task completes twice', () => {
    const rows = [trow(1, 1, { toStatus: 'completed' }), trow(1, 5, { toStatus: 'completed' })];
    const t1 = groupTaskEvents(rows)[0]!;
    expect(t1.completedAt).toEqual(at(5));
  });

  it('flags plan bounces via failed and exhausted causes', () => {
    const rows = [
      trow(1, 2, { cause: 'plan_critic_failed' }),
      trow(2, 2, { cause: 'plan_critic_exhausted' }),
    ];
    const events = groupTaskEvents(rows);
    expect(events.find((e) => e.taskId === 1)!.planBounced).toBe(true);
    expect(events.find((e) => e.taskId === 2)!.planBounced).toBe(true);
  });
});

describe('computeGrowthLedger — autonomy / criticFirstPass / repairEfficiency', () => {
  it('computes the three transition-based series per window, newest first', () => {
    const taskEvents = [
      taskEvent({
        taskId: 1,
        completedAt: at(1),
        verifyRepairCount: 2,
        ciRepairCount: 1,
        researchSavedAt: at(3),
      }),
      taskEvent({
        taskId: 2,
        completedAt: at(2),
        hadUserActor: true,
        researchSavedAt: at(4),
        researchBounced: true,
      }),
      taskEvent({ taskId: 3, completedAt: at(9), planSavedAt: at(2) }),
    ];
    const w = computeGrowthLedger(input({ taskEvents }), NOW, 7, 2);
    expect(w).toHaveLength(2);

    expect(w[0]!.autonomy).toEqual({ completed: 2, autonomous: 1, rate: 0.5 });
    expect(w[1]!.autonomy).toEqual({ completed: 1, autonomous: 1, rate: 1 });

    expect(w[0]!.criticFirstPass.research).toEqual({ total: 2, firstPass: 1, rate: 0.5 });
    expect(w[0]!.criticFirstPass.plan).toEqual({ total: 1, firstPass: 1, rate: 1 });

    expect(w[0]!.repairEfficiency).toEqual({ completedTasks: 2, totalRepairs: 3, avgPerTask: 1.5 });
    expect(w[1]!.repairEfficiency).toEqual({ completedTasks: 1, totalRepairs: 0, avgPerTask: 0 });
  });
});

describe('computeGrowthLedger — window boundaries', () => {
  it('assigns a completion exactly at now to the newest window', () => {
    const w = computeGrowthLedger(
      input({ taskEvents: [taskEvent({ completedAt: NOW })] }),
      NOW,
      7,
      2,
    );
    expect(w[0]!.autonomy.completed).toBe(1);
    expect(w[1]!.autonomy.completed).toBe(0);
  });

  it('assigns a completion exactly one windowMs old to the second window', () => {
    const w = computeGrowthLedger(
      input({ taskEvents: [taskEvent({ completedAt: at(7) })] }),
      NOW,
      7,
      2,
    );
    expect(w[0]!.autonomy.completed).toBe(0);
    expect(w[1]!.autonomy.completed).toBe(1);
  });

  it('ignores future and out-of-range events', () => {
    const taskEvents = [
      taskEvent({ taskId: 1, completedAt: at(-1) }), // future
      taskEvent({ taskId: 2, completedAt: at(14) }), // age >= windowMs * windowCount
    ];
    const w = computeGrowthLedger(input({ taskEvents }), NOW, 7, 2);
    expect(w[0]!.autonomy.completed).toBe(0);
    expect(w[1]!.autonomy.completed).toBe(0);
  });
});

describe('computeGrowthLedger — missing weeks', () => {
  it('yields zero counts and null rates for windows with no data', () => {
    const w = computeGrowthLedger(input({}), NOW, 7, 2);
    for (const win of w) {
      expect(win.autonomy).toEqual({ completed: 0, autonomous: 0, rate: null });
      expect(win.criticFirstPass.research).toEqual({ total: 0, firstPass: 0, rate: null });
      expect(win.criticFirstPass.plan).toEqual({ total: 0, firstPass: 0, rate: null });
      expect(win.repairEfficiency).toEqual({
        completedTasks: 0,
        totalRepairs: 0,
        avgPerTask: null,
      });
      expect(win.defectRecurrence).toEqual({ newConcerns: 0, recurring: 0, rate: null });
      expect(win.kbQuality).toEqual({ total: 0, validated: 0, rate: null });
    }
  });
});

describe('computeGrowthLedger — defectRecurrence (metric 4)', () => {
  it('counts a recurrence only when a terminal same-key concern predates the window', () => {
    const concerns: ConcernLite[] = [
      { key: 'src/a.ts', status: 'resolved', createdAt: at(20) }, // closed prior, outside range
      { key: 'src/a.ts', status: 'open', createdAt: at(3) }, // recurrence
      { key: 'src/b.ts', status: 'open', createdAt: at(2) }, // fresh location
    ];
    const w = computeGrowthLedger(input({ concerns }), NOW, 7, 2);
    expect(w[0]!.defectRecurrence).toEqual({ newConcerns: 2, recurring: 1, rate: 0.5 });
    // The prior at(20) is outside the covered range → not a "new concern" anywhere.
    expect(w[1]!.defectRecurrence).toEqual({ newConcerns: 0, recurring: 0, rate: null });
  });

  it('does not count an open (non-terminal) prior as a recurrence source', () => {
    const concerns: ConcernLite[] = [
      { key: 'src/a.ts', status: 'open', createdAt: at(20) },
      { key: 'src/a.ts', status: 'open', createdAt: at(3) },
    ];
    const w = computeGrowthLedger(input({ concerns }), NOW, 7, 1);
    expect(w[0]!.defectRecurrence).toEqual({ newConcerns: 1, recurring: 0, rate: 0 });
  });

  it('excludes keyless concerns from both numerator and denominator', () => {
    const concerns: ConcernLite[] = [{ key: null, status: 'open', createdAt: at(3) }];
    const w = computeGrowthLedger(input({ concerns }), NOW, 7, 1);
    expect(w[0]!.defectRecurrence).toEqual({ newConcerns: 0, recurring: 0, rate: null });
  });

  it('does not count a terminal prior created within the same window', () => {
    const concerns: ConcernLite[] = [
      { key: 'src/a.ts', status: 'resolved', createdAt: at(5) }, // same window, not before it
      { key: 'src/a.ts', status: 'open', createdAt: at(3) },
    ];
    const w = computeGrowthLedger(input({ concerns }), NOW, 7, 1);
    expect(w[0]!.defectRecurrence).toEqual({ newConcerns: 2, recurring: 0, rate: 0 });
  });
});

describe('computeGrowthLedger — kbQuality (metric 5)', () => {
  it('treats validation as point-in-time: a later validatedAt never lifts a past window', () => {
    const kbEntries: KbLite[] = [{ createdAt: at(10), validatedAt: at(2) }];
    const w = computeGrowthLedger(input({ kbEntries }), NOW, 7, 2);
    // Window 1 ends at(7): the entry exists but its validation (at(2)) is later.
    expect(w[1]!.kbQuality).toEqual({ total: 1, validated: 0, rate: 0 });
    // Window 0 ends at NOW: validation has happened by then.
    expect(w[0]!.kbQuality).toEqual({ total: 1, validated: 1, rate: 1 });
  });

  it('counts never-validated entries in the denominator only', () => {
    const kbEntries: KbLite[] = [
      { createdAt: at(1), validatedAt: null },
      { createdAt: at(1), validatedAt: at(0.5) },
    ];
    const w = computeGrowthLedger(input({ kbEntries }), NOW, 7, 1);
    expect(w[0]!.kbQuality).toEqual({ total: 2, validated: 1, rate: 0.5 });
  });

  it('excludes entries created after the window end from that window', () => {
    const kbEntries: KbLite[] = [{ createdAt: at(2), validatedAt: null }];
    const w = computeGrowthLedger(input({ kbEntries }), NOW, 7, 2);
    // Window 1 ends at(7) — the entry does not exist yet.
    expect(w[1]!.kbQuality).toEqual({ total: 0, validated: 0, rate: null });
    expect(w[0]!.kbQuality).toEqual({ total: 1, validated: 0, rate: 0 });
  });
});
