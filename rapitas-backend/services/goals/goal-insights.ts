/**
 * goal-insights
 *
 * Measures whether the product reaches its purpose (helping a person turn a
 * goal into milestones and get there): reach rate, resume-after-stall rate,
 * outcome quality and felt progress. Pure — callers load rows and pass `now`.
 * Not responsible for loading data or for the quality of any automated run.
 */
import { reachRateWithDue, toRateCount, type RateCount } from './milestone-achievement';
import { buildReachedLedger, type LedgerEntry, type ReopenRecord } from './goal-insights-ledger';

export { buildReachedLedger, type LedgerEntry, type ReopenRecord };

const DAY_MS = 86_400_000;

/**
 * Days without any update after which a goal counts as stalled.
 * Two weekly check-ins in a row with nothing to show is the point where
 * "busy week" stops being a sufficient explanation; 13 days is still one
 * missed week, 14 is two.
 */
export const STALL_DAYS = 14;

/** An update this close to a completion/reach time is the same moment, not a separate edit. */
const SAME_MOMENT_MS = 60_000;

/** Aggregation windows the API accepts. */
export const INSIGHT_PERIODS = ['4w', 'all'] as const;
/** One accepted period. */
export type InsightPeriod = (typeof INSIGHT_PERIODS)[number];

/** Why a metric has no rate. */
export type MetricReason = 'no-material' | 'no-reflection-source' | null;

/** A rate plus the counts and the reason it may be empty. */
export interface InsightMetric extends RateCount {
  reason: MetricReason;
}

/** The four metrics of one scope. */
export interface InsightMetrics {
  reachRate: InsightMetric;
  resumeRate: InsightMetric;
  quality: InsightMetric;
  feltProgress: InsightMetric;
}

/** A goal (Project) with just what the metrics read. */
export interface InsightGoal {
  id: number;
  createdAt: Date;
  name: string;
  milestones: Array<{
    id: number;
    status: string;
    dueDate: Date | null;
    reachedAt: Date | null;
    updatedAt: Date;
  }>;
  tasks: Array<{ status: string; updatedAt: Date; completedAt: Date | null }>;
}

/** One goal in the per-goal list. */
export interface GoalRow {
  id: number;
  name: string;
  reached: number;
  open: number;
  paused: number;
  /** Latest update of the goal, its milestones and tasks (ISO). */
  lastUpdatedAt: string;
  stalled: boolean;
}

/** The API response body. */
export interface InsightsResult {
  period: InsightPeriod;
  overall: InsightMetrics;
  goals: GoalRow[];
}

const withReason = (c: RateCount): InsightMetric => ({
  ...c,
  reason: c.denominator === 0 ? 'no-material' : null,
});

/**
 * Whether a goal last touched at `lastUpdate` is stalled at `now`.
 *
 * @param lastUpdate - Latest update of its milestones/tasks / 最終更新
 * @param now - Current time / 現在時刻
 * @param stallDays - Threshold in days / 停滞とみなす日数
 * @returns True once `stallDays` have fully passed (14 days is stalled, 13 is not) / 停滞か
 */
export function isStalled(lastUpdate: Date, now: Date, stallDays: number = STALL_DAYS): boolean {
  return now.getTime() - lastUpdate.getTime() >= stallDays * DAY_MS;
}

interface Activity {
  at: Date;
  /** A milestone reached or a task completed — not merely an edit. */
  advance: boolean;
}

function activities(goal: InsightGoal, coalesceUpdates = true): Activity[] {
  const out: Activity[] = [{ at: goal.createdAt, advance: false }];
  const push = (updatedAt: Date, advancedAt: Date | null) => {
    if (advancedAt) out.push({ at: advancedAt, advance: true });
    if (
      !coalesceUpdates ||
      !advancedAt ||
      Math.abs(updatedAt.getTime() - advancedAt.getTime()) > SAME_MOMENT_MS
    ) {
      out.push({ at: updatedAt, advance: false });
    }
  };
  for (const m of goal.milestones) push(m.updatedAt, m.reachedAt);
  for (const t of goal.tasks) push(t.updatedAt, t.completedAt);
  // Ties go to the advance so row order cannot hide a resume.
  return out.sort(
    (a, b) => a.at.getTime() - b.at.getTime() || Number(b.advance) - Number(a.advance),
  );
}

/** A goal with nothing left to pursue cannot stall. */
function isPursued(goal: InsightGoal): boolean {
  return goal.milestones.length === 0 || goal.milestones.some((m) => m.status === 'open');
}

interface Episode {
  start: Date;
  /** When the stall ended; null while it is ongoing. */
  end: Date | null;
  resumed: boolean;
}

// NOTE: No history table exists, so a stall is rebuilt from the latest update
// times only: gaps between consecutive known events, plus the open gap to now.
function stallEpisodes(goal: InsightGoal, now: Date): Episode[] {
  if (!isPursued(goal)) return [];
  const events = activities(goal);
  const episodes: Episode[] = [];
  for (let i = 1; i < events.length; i++) {
    if (isStalled(events[i - 1].at, events[i].at)) {
      const end = events[i];
      // 60秒の同一視は同一行だけ。同時刻の別行は activities のソートで前進を優先する。
      episodes.push({ start: events[i - 1].at, end: end.at, resumed: end.advance });
    }
  }
  const last = events[events.length - 1];
  if (isStalled(last.at, now)) episodes.push({ start: last.at, end: null, resumed: false });
  return episodes;
}

/**
 * Stall episodes that later saw a milestone reached or a task completed, over
 * all stall episodes. An edit alone ends a stall without counting as a resume.
 *
 * @param goals - Goals to judge / ゴール
 * @param now - Current time / 現在時刻
 * @param from - Keep episodes that ended (or, if ongoing, started) at/after this; null = all / 期間の開始
 * @returns Resumed and total episode counts / 再開率
 */
export function resumeMetric(
  goals: ReadonlyArray<InsightGoal>,
  now: Date,
  from: Date | null,
): InsightMetric {
  let resumed = 0;
  let total = 0;
  for (const g of goals) {
    for (const e of stallEpisodes(g, now)) {
      if (from && (e.end ?? e.start) < from) continue;
      total++;
      if (e.resumed) resumed++;
    }
  }
  return withReason(toRateCount(resumed, total));
}

/**
 * Outcome quality: reached milestones that were never undone, over all that
 * were ever reached.
 *
 * @param ledger - From `buildReachedLedger` / 到達台帳
 * @param from - Only entries reached at/after this; null = all / 期間の開始
 * @returns Kept and total counts / 成果の品質
 */
export function qualityMetric(
  ledger: ReadonlyArray<LedgerEntry>,
  from: Date | null,
): InsightMetric {
  const inScope = ledger.filter((e) => !from || (e.reachedAt !== null && e.reachedAt >= from));
  const kept = inScope.filter((e) => !e.reopened).length;
  return withReason(toRateCount(kept, inScope.length));
}

/** Latest update among the goal itself, its milestones and its tasks. */
function lastUpdate(goal: InsightGoal): Date {
  // 一覧では前進と更新をまとめず、元データにある全時刻の最大値を使う。
  const events = activities(goal, false);
  return events[events.length - 1].at;
}

/**
 * One row of the per-goal list.
 *
 * @param goal - The goal / ゴール
 * @param now - Current time / 現在時刻
 * @returns Milestone counts, last update and whether it is stalled now / ゴールの一覧行
 */
export function goalRow(goal: InsightGoal, now: Date): GoalRow {
  const last = lastUpdate(goal);
  const count = (status: string) => goal.milestones.filter((m) => m.status === status).length;
  return {
    id: goal.id,
    name: goal.name,
    reached: count('reached'),
    open: count('open'),
    paused: count('paused'),
    lastUpdatedAt: last.toISOString(),
    // A goal with nothing left to pursue is finished or parked, not stalled.
    stalled: isPursued(goal) && isStalled(last, now),
  };
}

function metricsFor(
  goals: ReadonlyArray<InsightGoal>,
  reopens: ReadonlyArray<ReopenRecord>,
  now: Date,
  from: Date | null,
): InsightMetrics {
  const milestones = goals.flatMap((g) => g.milestones);
  const ids = new Set(milestones.map((m) => m.id));
  return {
    reachRate: withReason(reachRateWithDue(milestones, now, from)),
    resumeRate: resumeMetric(goals, now, from),
    quality: qualityMetric(
      buildReachedLedger(
        milestones,
        reopens.filter((r) => ids.has(r.milestoneId)),
      ),
      from,
    ),
    // Weekly reflections (task 1567) are not stored yet.
    feltProgress: { numerator: 0, denominator: 0, rate: null, reason: 'no-reflection-source' },
  };
}

/**
 * Compute all four metrics overall and and a per-goal list.
 *
 * @param input - Goals, recorded cancellations, current time and period / 入力
 * @returns Overall metrics and one row per goal / 全体の指標とゴール別の一覧
 */
export function computeInsights(input: {
  goals: ReadonlyArray<InsightGoal>;
  reopenEvents: ReadonlyArray<ReopenRecord>;
  now: Date;
  period: InsightPeriod;
}): InsightsResult {
  const { goals, reopenEvents, now, period } = input;
  const from = period === '4w' ? new Date(now.getTime() - 28 * DAY_MS) : null;
  return {
    period,
    overall: metricsFor(goals, reopenEvents, now, from),
    // Stalled goals first, then the longest untouched: the ones to look at come up top.
    goals: goals
      .map((g) => goalRow(g, now))
      .sort(
        (a, b) =>
          Number(b.stalled) - Number(a.stalled) ||
          a.lastUpdatedAt.localeCompare(b.lastUpdatedAt) ||
          a.id - b.id,
      ),
  };
}
