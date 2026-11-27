/**
 * goal-insights.test
 *
 * The product-purpose metrics: reach rate, resume-after-stall rate, outcome
 * quality and felt progress — computed from tables of milestones and tasks.
 */
import { describe, expect, test } from 'bun:test';
import {
  STALL_DAYS,
  buildReachedLedger,
  computeInsights,
  goalRow,
  isStalled,
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

describe('STALL_DAYS / isStalled', () => {
  test('defaults to 14 days', () => {
    expect(STALL_DAYS).toBe(14);
  });

  test('13 days without update is not stalled, 14 days is', () => {
    expect(isStalled(day(-13), NOW)).toBe(false);
    expect(isStalled(day(-14), NOW)).toBe(true);
    expect(isStalled(day(-15), NOW)).toBe(true);
  });
});

describe('resumeMetric', () => {
  test('a goal quiet for 13 days has no stall episode (null, not 0%)', () => {
    const g = goal({ createdAt: day(-13), milestones: [milestone({ updatedAt: day(-13) })] });
    expect(resumeMetric([g], NOW, null)).toMatchObject({
      numerator: 0,
      denominator: 0,
      rate: null,
    });
  });

  test('a goal quiet for exactly 14 days is one unresumed stall', () => {
    const g = goal({ createdAt: day(-14), milestones: [milestone({ updatedAt: day(-14) })] });
    expect(resumeMetric([g], NOW, null)).toMatchObject({ numerator: 0, denominator: 1, rate: 0 });
  });

  test('a stall ended by a task completion counts as resumed', () => {
    const g = goal({
      createdAt: day(-60),
      milestones: [milestone({ updatedAt: day(-60) })],
      tasks: [task({ status: 'done', updatedAt: day(-10), completedAt: day(-10) })],
    });
    expect(resumeMetric([g], NOW, null)).toMatchObject({ numerator: 1, denominator: 1, rate: 1 });
  });

  test('a stall ended by a mere edit is not a resume', () => {
    const g = goal({
      createdAt: day(-60),
      tasks: [task({ updatedAt: day(-10) })],
    });
    // gap 50d (ended by an edit) → not resumed; then 10d to now is not stalled
    expect(resumeMetric([g], NOW, null)).toMatchObject({ numerator: 0, denominator: 1, rate: 0 });
  });

  test('a stall ended by a milestone reached counts as resumed', () => {
    const g = goal({
      createdAt: day(-40),
      milestones: [
        milestone({ id: 1, status: 'reached', reachedAt: day(-5), updatedAt: day(-5) }),
        milestone({ id: 2, status: 'open', updatedAt: day(-5) }),
      ],
    });
    expect(resumeMetric([g], NOW, null).numerator).toBe(1);
  });

  test('goals whose milestones are all reached or all paused are not judged', () => {
    const done = goal({
      milestones: [milestone({ status: 'reached', reachedAt: day(-90), updatedAt: day(-90) })],
    });
    const paused = goal({ id: 2, milestones: [milestone({ status: 'paused' })] });
    expect(resumeMetric([done, paused], NOW, null)).toMatchObject({
      numerator: 0,
      denominator: 0,
      rate: null,
    });
  });

  test('a period start drops episodes that ended before it', () => {
    const g = goal({
      createdAt: day(-100),
      tasks: [task({ status: 'done', updatedAt: day(-60), completedAt: day(-60) })],
    });
    // episodes: -100→-60 (resumed, ended -60), -60→now (stalled, ongoing, start -60)
    expect(resumeMetric([g], NOW, null).denominator).toBe(2);
    expect(resumeMetric([g], NOW, day(-28)).denominator).toBe(0);
  });

  test('no goals at all is null', () => {
    expect(resumeMetric([], NOW, null).rate).toBeNull();
  });
});

describe('quality', () => {
  test('ledger: currently reached, reopened-and-open, and reopened-then-reached', () => {
    const ledger = buildReachedLedger(
      [
        milestone({ id: 1, status: 'reached', reachedAt: day(-3) }),
        milestone({ id: 2, status: 'open' }),
        milestone({ id: 3, status: 'reached', reachedAt: day(-1) }),
        milestone({ id: 4, status: 'open' }),
      ],
      [
        { milestoneId: 2, reachedAt: day(-9).toISOString() },
        { milestoneId: 3, reachedAt: day(-8).toISOString() },
      ],
    );
    expect(ledger).toEqual([
      { reachedAt: day(-3), reopened: false },
      { reachedAt: day(-9), reopened: true },
      { reachedAt: day(-1), reopened: true },
    ]);
  });

  test('1 − reopened ÷ ever-reached', () => {
    const ledger = [
      { reachedAt: day(-3), reopened: false },
      { reachedAt: day(-4), reopened: false },
      { reachedAt: day(-5), reopened: false },
      { reachedAt: day(-6), reopened: true },
    ];
    expect(qualityMetric(ledger, null)).toMatchObject({ numerator: 3, denominator: 4, rate: 0.75 });
  });

  test('no reached milestone gives null', () => {
    expect(qualityMetric([], null)).toMatchObject({ numerator: 0, denominator: 0, rate: null });
  });

  test('period filters by reach time', () => {
    const ledger = [
      { reachedAt: day(-3), reopened: false },
      { reachedAt: day(-90), reopened: true },
    ];
    expect(qualityMetric(ledger, day(-28))).toMatchObject({
      numerator: 1,
      denominator: 1,
      rate: 1,
    });
  });
});

describe('computeInsights', () => {
  test('with no material every metric has a null rate and felt progress says why', () => {
    const r = computeInsights({ goals: [], reopenEvents: [], now: NOW, period: '4w' });
    expect(r.period).toBe('4w');
    for (const k of ['reachRate', 'resumeRate', 'quality', 'feltProgress'] as const) {
      expect(r.overall[k].rate).toBeNull();
    }
    expect(r.overall.feltProgress.reason).toBe('no-reflection-source');
    expect(r.goals).toEqual([]);
  });
});

describe('goalRow / per-goal list', () => {
  test('counts milestones by status and reports the latest update', () => {
    const g = goal({
      name: '資格',
      milestones: [
        milestone({ id: 1, status: 'reached', reachedAt: day(-2), updatedAt: day(-2) }),
        milestone({ id: 2, status: 'open', updatedAt: day(-1) }),
        milestone({ id: 3, status: 'paused', updatedAt: day(-30) }),
      ],
      tasks: [task({ updatedAt: day(-5) })],
    });
    expect(goalRow(g, NOW)).toEqual({
      id: 1,
      name: '資格',
      reached: 1,
      open: 1,
      paused: 1,
      lastUpdatedAt: day(-1).toISOString(),
      stalled: false,
    });
  });

  test('stalled flips between 13 and 14 days since the last update', () => {
    const open = (days: number) =>
      goal({ createdAt: day(-days), milestones: [milestone({ updatedAt: day(-days) })] });
    expect(goalRow(open(13), NOW).stalled).toBe(false);
    expect(goalRow(open(14), NOW).stalled).toBe(true);
  });

  test('a goal with every milestone reached is never stalled', () => {
    const g = goal({
      createdAt: day(-90),
      milestones: [milestone({ status: 'reached', reachedAt: day(-90), updatedAt: day(-90) })],
    });
    expect(goalRow(g, NOW).stalled).toBe(false);
  });

  test('computeInsights lists every goal', () => {
    const r = computeInsights({
      goals: [goal({ id: 1 }), goal({ id: 2, name: '別' })],
      reopenEvents: [],
      now: NOW,
      period: 'all',
    });
    expect(r.goals.map((x) => x.id)).toEqual([1, 2]);
  });
});

describe('goal list order', () => {
  test('stalled goals come first, then the least recently updated', () => {
    const open = (id: number, ageDays: number) =>
      goal({
        id,
        createdAt: day(-ageDays),
        milestones: [milestone({ id, updatedAt: day(-ageDays) })],
      });
    const r = computeInsights({
      goals: [open(1, 2), open(2, 20), open(3, 5), open(4, 30)],
      reopenEvents: [],
      now: NOW,
      period: 'all',
    });
    // 4 and 2 are stalled (30d, 20d); then 3 (5d old) before 1 (2d old).
    expect(r.goals.map((x) => x.id)).toEqual([4, 2, 3, 1]);
  });
});
