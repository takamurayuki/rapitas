/**
 * goal-insights.edge.test
 *
 * Regressions and edge cases for goal-insights: same-moment events, last update,
 * ledger corner cases and exact period boundaries.
 */
import { describe, expect, test } from 'bun:test';
import {
  buildReachedLedger,
  computeInsights,
  goalRow,
  qualityMetric,
  resumeMetric,
  type InsightGoal,
} from './goal-insights';

const NOW = new Date('2026-11-26T00:00:00Z');
const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

const goal = (over: Partial<InsightGoal> = {}): InsightGoal => ({
  id: 1,
  createdAt: day(-100),
  name: 'ゴール',
  milestones: [],
  tasks: [],
  ...over,
});
const milestone = (over: Partial<InsightGoal['milestones'][number]> = {}) => ({
  id: 1,
  status: 'open',
  dueDate: null,
  reachedAt: null,
  updatedAt: day(-100),
  ...over,
});
const task = (over: Partial<InsightGoal['tasks'][number]> = {}) => ({
  status: 'todo',
  updatedAt: day(-100),
  completedAt: null,
  ...over,
});

describe('R1/R2 regressions: same moment and last update', () => {
  test('a milestone edit at the same instant as a task completion does not hide the resume', () => {
    const t = day(-5);
    const g = goal({
      createdAt: day(-60),
      // The edit row is listed before the completion row on purpose.
      milestones: [milestone({ id: 1, status: 'open', updatedAt: t })],
      tasks: [task({ status: 'done', updatedAt: t, completedAt: t })],
    });
    expect(resumeMetric([g], NOW, null)).toMatchObject({ numerator: 1, denominator: 1, rate: 1 });
  });

  test.each([
    [-60_000, 0],
    [-30_000, 0],
    [-1, 0],
    [0, 1],
    [1, 1],
    [30_000, 1],
    [60_000, 1],
  ])('別行の編集が完了から %i ms の場合、再開数は %i', (offset, numerator) => {
    const g = goal({
      createdAt: day(-60),
      milestones: [
        milestone({ id: 1, status: 'open', updatedAt: new Date(day(-5).getTime() + offset) }),
      ],
      tasks: [task({ status: 'done', updatedAt: day(-5), completedAt: day(-5) })],
    });
    expect(resumeMetric([g], NOW, null)).toMatchObject({ numerator, denominator: 1 });
  });

  test.each([
    [-60_001, 0],
    [-60_000, 1],
    [-30_000, 1],
    [30_000, 1],
    [60_000, 1],
    [60_001, 1],
  ])('同一行の更新が完了から %i ms の場合、再開数は %i', (offset, numerator) => {
    const g = goal({
      createdAt: day(-60),
      tasks: [
        task({
          status: 'done',
          updatedAt: new Date(day(-5).getTime() + offset),
          completedAt: day(-5),
        }),
      ],
    });
    expect(resumeMetric([g], NOW, null)).toMatchObject({ numerator, denominator: 1 });
  });

  test.each(['task', 'milestone'] as const)(
    '%s の前進30秒後の更新も一覧の最終時刻に含め、14日未満は停滞にしない',
    (kind) => {
      const advancedAt = day(-14);
      const updatedAt = new Date(advancedAt.getTime() + 30_000);
      const g = goal({
        createdAt: day(-60),
        milestones: [milestone({ updatedAt: day(-60) })],
      });
      if (kind === 'task') {
        g.tasks.push(task({ status: 'done', updatedAt, completedAt: advancedAt }));
      } else {
        g.milestones.push(
          milestone({ id: 2, status: 'reached', updatedAt, reachedAt: advancedAt }),
        );
      }
      expect(goalRow(g, NOW)).toMatchObject({
        lastUpdatedAt: updatedAt.toISOString(),
        stalled: false,
      });
    },
  );

  test('last update counts completedAt and reachedAt, not only updatedAt', () => {
    const g = goal({
      createdAt: day(-60),
      milestones: [milestone({ id: 1, status: 'open', updatedAt: day(-20) })],
      tasks: [task({ status: 'done', updatedAt: day(-20), completedAt: day(-1) })],
    });
    const row = goalRow(g, NOW);
    expect(row.lastUpdatedAt).toBe(day(-1).toISOString());
    expect(row.stalled).toBe(false);
  });
});

describe('ledger edge cases and exact period boundaries', () => {
  test('open with a retained reachedAt (PATCH undo) is counted once, from the record', () => {
    const ledger = buildReachedLedger(
      [milestone({ id: 5, status: 'open', reachedAt: day(-2) })],
      [{ milestoneId: 5, reachedAt: day(-9).toISOString() }],
    );
    expect(ledger).toEqual([{ reachedAt: day(-9), reopened: true }]);
  });

  test('several records for one milestone give one entry at the earliest reach time', () => {
    const ledger = buildReachedLedger(
      [milestone({ id: 6, status: 'open' })],
      [
        { milestoneId: 6, reachedAt: day(-3).toISOString() },
        { milestoneId: 6, reachedAt: day(-8).toISOString() },
        { milestoneId: 6, reachedAt: null },
      ],
    );
    expect(ledger).toEqual([{ reachedAt: day(-8), reopened: true }]);
  });

  test('records for a milestone that is not in scope add nothing', () => {
    expect(buildReachedLedger([], [{ milestoneId: 1, reachedAt: null }])).toEqual([]);
  });

  test('quality: reached exactly at the period start is in, one ms before is out', () => {
    const from = day(-28);
    const at = (ms: number) => new Date(from.getTime() + ms);
    expect(
      qualityMetric(
        [
          { reachedAt: at(0), reopened: false },
          { reachedAt: at(-1), reopened: true },
        ],
        from,
      ),
    ).toMatchObject({ numerator: 1, denominator: 1 });
  });

  test('resume: a stall that ended exactly at the period start is in, one ms before is out', () => {
    const from = day(-28);
    // One 20-day stall (created -> completed); the quiet time after it is shorter than 14 days.
    const mk = (endMs: number) => {
      const end = new Date(from.getTime() + endMs);
      return goal({
        createdAt: new Date(end.getTime() - 20 * 86_400_000),
        tasks: [task({ status: 'done', updatedAt: end, completedAt: end })],
        milestones: [milestone({ updatedAt: end })],
      });
    };
    // The stall that ends at `from` and the open stall that starts there are both in scope.
    expect(resumeMetric([mk(0)], NOW, from).denominator).toBe(2);
    expect(resumeMetric([mk(-1)], NOW, from).denominator).toBe(0);
  });

  test('period 4w drops an old reach that period all keeps (computeInsights)', () => {
    const g = goal({
      milestones: [
        milestone({ id: 1, status: 'reached', reachedAt: day(-40), updatedAt: day(-40) }),
        milestone({ id: 2, status: 'reached', reachedAt: day(-2), updatedAt: day(-2) }),
      ],
    });
    const four = computeInsights({ goals: [g], reopenEvents: [], now: NOW, period: '4w' });
    const all = computeInsights({ goals: [g], reopenEvents: [], now: NOW, period: 'all' });
    expect(four.overall.reachRate).toMatchObject({ numerator: 1, denominator: 1 });
    expect(all.overall.reachRate).toMatchObject({ numerator: 2, denominator: 2 });
  });
});
