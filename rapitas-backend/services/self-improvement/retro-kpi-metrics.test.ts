/**
 * retro-kpi-metrics.test
 *
 * Unit tests for the pure retro-KPI core: per-task grouping, window binning,
 * distinct-task repair rate, lead-time median and the five count series. The
 * Prisma shell (computeRetroKpiMetrics) is a thin wrapper and is not
 * exercised here (same policy as growth-ledger-metrics.test.ts).
 */
import { describe, it, expect } from 'bun:test';
import {
  groupRetroKpiTaskEvents,
  computeRetroKpiLedger,
  computeMedian,
  AUTO_MERGED_CAUSE,
  CONFLICT_FILED_CAUSE,
  NO_CHANGE_CONFIRMED_CAUSE,
  VERIFY_REPAIR_CAUSE,
  RETRO_KPI_COUNT_CAUSES,
  type RetroKpiTransitionRow,
  type RetroKpiTaskEventLite,
  type RetroKpiCountRow,
} from './retro-kpi-metrics';
import { EXHAUSTED_CAUSE } from '../workflow/auto-merge-exhaustion';
import { VERIFY_NON_CONVERGENCE_CAUSE } from '../workflow/blocked-task-policy';

const NOW = new Date('2026-08-30T00:00:00Z');
const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

/** Timestamp `daysAgo` days before NOW (negative = future). */
function at(daysAgo: number): Date {
  return new Date(NOW.getTime() - daysAgo * DAY_MS);
}

/** Shorthand transition row for taskId at `daysAgo`, with overrides. */
function trow(
  taskId: number,
  daysAgo: number,
  over: Partial<RetroKpiTransitionRow> = {},
): RetroKpiTransitionRow {
  return { taskId, toStatus: null, cause: null, createdAt: at(daysAgo), ...over };
}

/** Task summary completed `completedDaysAgo` days ago after `leadMinutes` of lead time. */
function completedTask(
  taskId: number,
  completedDaysAgo: number,
  leadMinutes: number,
  hadVerifyRepair = false,
): RetroKpiTaskEventLite {
  const completedAt = at(completedDaysAgo);
  return {
    taskId,
    firstTransitionAt: new Date(completedAt.getTime() - leadMinutes * MINUTE_MS),
    completedAt,
    hadVerifyRepair,
  };
}

function crow(cause: string | null, daysAgo: number): RetroKpiCountRow {
  return { cause, createdAt: at(daysAgo) };
}

describe('cause constants', () => {
  it('pin the exact cause strings written by the production code paths', () => {
    expect(AUTO_MERGED_CAUSE).toBe('auto_merged');
    expect(EXHAUSTED_CAUSE).toBe('auto_merge_exhausted');
    expect(CONFLICT_FILED_CAUSE).toBe('auto_merge_conflict_filed');
    expect(NO_CHANGE_CONFIRMED_CAUSE).toBe('verify_no_change_confirmed');
    expect(VERIFY_NON_CONVERGENCE_CAUSE).toBe('verify_repair_non_convergence');
    expect(VERIFY_REPAIR_CAUSE).toBe('verify_repair');
    expect([...RETRO_KPI_COUNT_CAUSES]).toEqual([
      'auto_merged',
      'auto_merge_exhausted',
      'auto_merge_conflict_filed',
      'verify_no_change_confirmed',
      'verify_repair_non_convergence',
    ]);
  });
});

describe('groupRetroKpiTaskEvents', () => {
  it('keeps the oldest transition as firstTransitionAt regardless of row order', () => {
    const [ev] = groupRetroKpiTaskEvents([
      trow(1, 2, { toStatus: 'in_progress' }),
      trow(1, 5, { toStatus: 'draft' }),
      trow(1, 3, { toStatus: 'research_done' }),
    ]);
    expect(ev!.firstTransitionAt).toEqual(at(5));
    expect(ev!.completedAt).toBeNull();
  });

  it('attributes completedAt to the FIRST completion (re-completion ignored)', () => {
    const [ev] = groupRetroKpiTaskEvents([
      trow(1, 1, { toStatus: 'completed' }),
      trow(1, 4, { toStatus: 'completed' }),
    ]);
    expect(ev!.completedAt).toEqual(at(4));
  });

  it('flags hadVerifyRepair once even when verify_repair occurs three times', () => {
    const events = groupRetroKpiTaskEvents([
      trow(7, 6, { toStatus: 'draft' }),
      trow(7, 5, { cause: VERIFY_REPAIR_CAUSE }),
      trow(7, 4, { cause: VERIFY_REPAIR_CAUSE }),
      trow(7, 3, { cause: VERIFY_REPAIR_CAUSE }),
      trow(7, 1, { toStatus: 'completed' }),
      trow(8, 1, { toStatus: 'completed' }),
    ]);
    expect(events).toHaveLength(2);
    expect(events.find((e) => e.taskId === 7)!.hadVerifyRepair).toBe(true);
    expect(events.find((e) => e.taskId === 8)!.hadVerifyRepair).toBe(false);

    const [w] = computeRetroKpiLedger(events, [], NOW, 7, 1);
    expect(w!.repairRate).toEqual({ completedTasks: 2, repairedTasks: 1, rate: 0.5 });
  });
});

describe('computeMedian', () => {
  it('returns the middle element for odd counts', () => {
    expect(computeMedian([10, 20, 30])).toBe(20);
  });
  it('averages the two middle elements for even counts and rounds', () => {
    expect(computeMedian([10, 20, 30, 40])).toBe(25);
    expect(computeMedian([10, 21])).toBe(16);
  });
  it('returns null for an empty input', () => {
    expect(computeMedian([])).toBeNull();
  });
});

describe('computeRetroKpiLedger — repair rate', () => {
  it('yields rate=null when no task completed in the window', () => {
    const [w] = computeRetroKpiLedger([], [], NOW, 7, 1);
    expect(w!.repairRate).toEqual({ completedTasks: 0, repairedTasks: 0, rate: null });
    expect(w!.leadTimeMinutes).toEqual({ sampleSize: 0, medianMinutes: null });
  });

  it('attributes the numerator to the completedAt week, not the verify_repair week', () => {
    // verify_repair happened 10 days ago (window index 1), completion 2 days ago (window 0).
    const events = groupRetroKpiTaskEvents([
      trow(1, 12, { toStatus: 'draft' }),
      trow(1, 10, { cause: VERIFY_REPAIR_CAUSE }),
      trow(1, 2, { toStatus: 'completed' }),
    ]);
    const windows = computeRetroKpiLedger(events, [], NOW, 7, 2);
    expect(windows[0]!.repairRate).toEqual({ completedTasks: 1, repairedTasks: 1, rate: 1 });
    expect(windows[1]!.repairRate).toEqual({ completedTasks: 0, repairedTasks: 0, rate: null });
  });

  it('excludes never-completed tasks from both repair-rate and lead-time denominators', () => {
    const events: RetroKpiTaskEventLite[] = [
      { taskId: 1, firstTransitionAt: at(3), completedAt: null, hadVerifyRepair: true },
      completedTask(2, 1, 30),
    ];
    const [w] = computeRetroKpiLedger(events, [], NOW, 7, 1);
    expect(w!.repairRate).toEqual({ completedTasks: 1, repairedTasks: 0, rate: 0 });
    expect(w!.leadTimeMinutes).toEqual({ sampleSize: 1, medianMinutes: 30 });
  });
});

describe('computeRetroKpiLedger — window boundaries', () => {
  it('places age===windowMs in the next window and age===windowMs*windowCount out of range', () => {
    const rows = [
      crow(AUTO_MERGED_CAUSE, 0), // age 0 → window 0
      crow(AUTO_MERGED_CAUSE, 7), // age == windowMs → window 1 (to is exclusive)
      crow(AUTO_MERGED_CAUSE, 14), // age == windowMs*windowCount → excluded
      crow(AUTO_MERGED_CAUSE, -1), // future → excluded
    ];
    const windows = computeRetroKpiLedger([], rows, NOW, 7, 2);
    expect(windows[0]!.autoMerged).toBe(1);
    expect(windows[1]!.autoMerged).toBe(1);
    expect(windows[0]!.from).toBe(at(7).toISOString());
    expect(windows[0]!.to).toBe(NOW.toISOString());
    expect(windows[1]!.from).toBe(at(14).toISOString());
  });

  it('returns windows newest first with windowCount entries', () => {
    const windows = computeRetroKpiLedger([], [], NOW, 7, 8);
    expect(windows).toHaveLength(8);
    expect(new Date(windows[0]!.to).getTime()).toBeGreaterThan(new Date(windows[7]!.to).getTime());
  });
});

describe('computeRetroKpiLedger — lead time', () => {
  it('computes the median over tasks completed in the window (odd count)', () => {
    const events = [completedTask(1, 1, 10), completedTask(2, 2, 30), completedTask(3, 3, 20)];
    const [w] = computeRetroKpiLedger(events, [], NOW, 7, 1);
    expect(w!.leadTimeMinutes).toEqual({ sampleSize: 3, medianMinutes: 20 });
  });

  it('averages the middle pair for an even count and rounds seconds to minutes', () => {
    const events = [
      completedTask(1, 1, 10),
      completedTask(2, 2, 40),
      completedTask(3, 3, 20),
      completedTask(4, 4, 30.4), // 30m24s → rounds to 30
    ];
    const [w] = computeRetroKpiLedger(events, [], NOW, 7, 1);
    expect(w!.leadTimeMinutes).toEqual({ sampleSize: 4, medianMinutes: 25 });
  });

  it('measures from the first transition even when it predates the window', () => {
    const events = groupRetroKpiTaskEvents([
      trow(1, 20, { toStatus: 'draft' }), // outside the 7-day window
      trow(1, 1, { toStatus: 'completed' }),
    ]);
    const [w] = computeRetroKpiLedger(events, [], NOW, 7, 1);
    expect(w!.leadTimeMinutes).toEqual({ sampleSize: 1, medianMinutes: 19 * 24 * 60 });
  });
});

describe('computeRetroKpiLedger — count series', () => {
  it('counts each known cause independently and ignores unknown causes', () => {
    const rows = [
      crow(AUTO_MERGED_CAUSE, 1),
      crow(AUTO_MERGED_CAUSE, 2),
      crow(EXHAUSTED_CAUSE, 1),
      crow(CONFLICT_FILED_CAUSE, 3),
      crow(NO_CHANGE_CONFIRMED_CAUSE, 4),
      crow(NO_CHANGE_CONFIRMED_CAUSE, 4),
      crow(NO_CHANGE_CONFIRMED_CAUSE, 5),
      crow(VERIFY_NON_CONVERGENCE_CAUSE, 6),
      crow('ci_repair', 1),
      crow(VERIFY_REPAIR_CAUSE, 1),
      crow(null, 1),
    ];
    const [w] = computeRetroKpiLedger([], rows, NOW, 7, 1);
    expect(w!.autoMerged).toBe(2);
    expect(w!.autoMergeExhausted).toBe(1);
    expect(w!.autoMergeConflictFiled).toBe(1);
    expect(w!.verifyNoChangeConfirmed).toBe(3);
    expect(w!.verifyRepairNonConvergence).toBe(1);
  });

  it('counts transitions (not distinct tasks) — repeated rows all count', () => {
    const rows = [crow(EXHAUSTED_CAUSE, 1), crow(EXHAUSTED_CAUSE, 1), crow(EXHAUSTED_CAUSE, 2)];
    const [w] = computeRetroKpiLedger([], rows, NOW, 7, 1);
    expect(w!.autoMergeExhausted).toBe(3);
  });
});
