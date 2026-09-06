/**
 * improvement-digest.test
 *
 * Index maths, verdict banding, and ledger pairing for the growth digest.
 */
import { describe, it, expect } from 'vitest';
import {
  computeImprovementDigest,
  decideVerdict,
  improvementIndex,
} from '../components/improvement-digest';
import type { GrowthLedgerWindow, RetroKpiWindow } from '../types';

const growth = (
  to: string,
  rates: Partial<{
    autonomy: number | null;
    research: number | null;
    plan: number | null;
    recurrence: number | null;
    kb: number | null;
  }> = {},
): GrowthLedgerWindow => ({
  from: to,
  to,
  // `null` must survive (a window with no sample), so only absent keys default.
  // Samples ≥ MIN_RATE_SAMPLE so every rate counts unless a test shrinks it.
  autonomy: { completed: 8, autonomous: 6, rate: 'autonomy' in rates ? rates.autonomy! : 0.75 },
  criticFirstPass: {
    research: { total: 8, firstPass: 4, rate: 'research' in rates ? rates.research! : 0.5 },
    plan: { total: 8, firstPass: 8, rate: 'plan' in rates ? rates.plan! : 1 },
  },
  repairEfficiency: { completedTasks: 4, totalRepairs: 2, avgPerTask: 0.5 },
  defectRecurrence: {
    newConcerns: 10,
    recurring: 2,
    rate: 'recurrence' in rates ? rates.recurrence! : 0.2,
  },
  kbQuality: { total: 100, validated: 25, rate: 'kb' in rates ? rates.kb! : 0.25 },
});

const retro = (to: string, repairRate: number | null, autoMerged = 3): RetroKpiWindow => ({
  from: to,
  to,
  repairRate: { completedTasks: 8, repairedTasks: 2, rate: repairRate },
  autoMerged,
  autoMergeExhausted: 0,
  autoMergeConflictFiled: 0,
  verifyNoChangeConfirmed: 0,
  verifyRepairNonConvergence: 0,
  leadTimeMinutes: { sampleSize: 4, medianMinutes: 120 },
});

describe('improvementIndex', () => {
  it('drops rates whose sample is below MIN_RATE_SAMPLE', () => {
    // plan 1/1 (=100%) and research 0/0 fall under the sample floor → excluded.
    const wide = growth('2026-09-06T00:00:00.000Z');
    wide.autonomy = { completed: 10, autonomous: 5, rate: 0.5 };
    wide.criticFirstPass.plan = { total: 1, firstPass: 1, rate: 1 };
    wide.criticFirstPass.research = { total: 0, firstPass: 0, rate: null };
    // counted: autonomy 0.5, recurrence (10 ≥ 5) 0.8, kb (100) 0.25 → mean 0.5167 → 52
    expect(improvementIndex(wide, undefined)).toBe(52);
  });

  it('averages the available rates, inverting lower-is-better ones', () => {
    // 0.75, 0.5, 1, (1-0.2)=0.8, 0.25, (1-0.25)=0.75 → mean 0.675 → 68
    expect(
      improvementIndex(growth('2026-09-06T00:00:00.000Z'), retro('2026-09-06T00:00:00.000Z', 0.25)),
    ).toBe(68);
  });

  it('ignores rates without a sample and returns null when nothing measured', () => {
    const empty = growth('2026-09-06T00:00:00.000Z', {
      autonomy: null,
      research: null,
      plan: null,
      recurrence: null,
      kb: null,
    });
    expect(improvementIndex(empty, undefined)).toBeNull();
    expect(improvementIndex(empty, retro('2026-09-06T00:00:00.000Z', 0.1))).toBe(90);
  });
});

describe('decideVerdict', () => {
  it('bands movement into improving / flat / worsening and needs two weeks', () => {
    expect(decideVerdict(70, 65)).toBe('improving');
    expect(decideVerdict(66, 65)).toBe('flat');
    expect(decideVerdict(60, 65)).toBe('worsening');
    expect(decideVerdict(60, null)).toBe('insufficient');
  });
});

describe('computeImprovementDigest', () => {
  it('pairs ledgers by week, orders the series oldest-first, and fills diffs', () => {
    const g = [
      growth('2026-09-06T00:00:00.000Z', { autonomy: 1 }),
      growth('2026-08-30T00:00:00.000Z', { autonomy: 0.5 }),
    ];
    const r = [
      retro('2026-09-06T01:00:00.000Z', 0.25, 5),
      retro('2026-08-30T01:00:00.000Z', 0.5, 2),
    ];
    const d = computeImprovementDigest(g, r, (iso) => iso.slice(5, 10));
    expect(d.indexSeries.map((p) => p.weekLabel)).toEqual(['08-30', '09-06']);
    expect(d.latestIndex).toBeGreaterThan(d.previousIndex!);
    expect(d.verdict).toBe('improving');
    expect(d.rates.find((m) => m.key === 'autonomy')).toMatchObject({ current: 1, previous: 0.5 });
    expect(d.rates.find((m) => m.key === 'repairRate')).toMatchObject({
      current: 0.25,
      previous: 0.5,
    });
    expect(d.tiles.find((m) => m.key === 'autoMerged')).toMatchObject({ current: 5, previous: 2 });
    expect(d.tiles.find((m) => m.key === 'repairRate')).toMatchObject({
      current: 0.25,
      previous: 0.5,
    });
    expect(d.tiles).toHaveLength(3);
  });

  it('handles a missing retro ledger without fabricating values', () => {
    const d = computeImprovementDigest([growth('2026-09-06T00:00:00.000Z')], [], (iso) => iso);
    expect(d.verdict).toBe('insufficient');
    expect(d.rates.find((m) => m.key === 'repairRate')?.current).toBeNull();
    expect(d.tiles.find((m) => m.key === 'autoMerged')?.current).toBeNull();
  });
});
