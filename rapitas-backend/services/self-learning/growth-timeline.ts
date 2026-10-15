/**
 * growth-timeline
 *
 * Day-by-day self-learning growth timeline for the agent-memory page.
 * Bulk-fetches each series once and buckets in JS — the previous
 * implementation issued 7 queries PER DAY (700+ queries for period='all').
 * Owns only the timeline; the memory overview lives in stats-ops.ts.
 */
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import type { GrowthTimeline, GrowthTimelineEntry } from './types';

const log = createLogger('self-learning:growth-timeline');

/** Trailing window (days) for the per-day confidence average. */
const CONFIDENCE_WINDOW_DAYS = 7;

/** Raw per-series timestamps needed to compute the timeline. */
export interface TimelineSeries {
  nodeDates: Date[];
  edgeDates: Date[];
  patternDates: Date[];
  promptDates: Date[];
  experiments: Array<{
    createdAt: Date;
    completedAt: Date | null;
    status: string;
    confidence: number;
  }>;
}

/** Count of items with timestamp <= limit, assuming `sorted` is ascending. */
function countUpTo(sorted: number[], limit: number): number {
  // Binary search for the upper bound — O(log n) per day.
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] <= limit) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Pure timeline computation from pre-fetched series. Exported for unit tests.
 *
 * NOTE: avgConfidence is a TRAILING-WINDOW mean over experiments that reached
 * a terminal state (completed OR failed) within the last 7 days — not the
 * all-history cumulative mean of successes the previous version used. That
 * cumulative-successes-only design was why the confidence chart flatlined:
 * every successful experiment carried the same hardcoded 0.8, and failures
 * were excluded, so the average was 0.8 by construction on every single day.
 * Days with no terminal experiments in the window emit 0 (the chart treats 0
 * as "no data" and hides the bar).
 *
 * @param dates - Ascending ISO dates (yyyy-mm-dd) to compute entries for. / 対象日
 * @param series - Pre-fetched per-series timestamps. / 取得済み時系列データ
 * @returns One timeline entry per input date. / 日次エントリ
 */
export function computeGrowthTimeline(
  dates: string[],
  series: TimelineSeries,
): GrowthTimelineEntry[] {
  const toSorted = (ds: Date[]) => ds.map((d) => d.getTime()).sort((a, b) => a - b);
  const nodeTimes = toSorted(series.nodeDates);
  const edgeTimes = toSorted(series.edgeDates);
  const patternTimes = toSorted(series.patternDates);
  const promptTimes = toSorted(series.promptDates);
  const expCreatedTimes = toSorted(series.experiments.map((e) => e.createdAt));
  const completedTimes = toSorted(
    series.experiments
      .filter((e) => e.status === 'completed' && e.completedAt)
      .map((e) => e.completedAt as Date),
  );

  // Terminal experiments (success AND failure) carry the learning-confidence
  // signal for the windowed average.
  const terminal = series.experiments
    .filter((e) => (e.status === 'completed' || e.status === 'failed') && e.completedAt)
    .map((e) => ({ at: (e.completedAt as Date).getTime(), confidence: e.confidence }))
    .sort((a, b) => a.at - b.at);
  const terminalTimes = terminal.map((t) => t.at);

  const windowMs = CONFIDENCE_WINDOW_DAYS * 24 * 60 * 60 * 1000;

  return dates.map((date) => {
    const endOfDay = new Date(`${date}T23:59:59.999Z`).getTime();

    const completedExpCount = countUpTo(completedTimes, endOfDay);
    const totalExpCount = countUpTo(expCreatedTimes, endOfDay);

    const windowEnd = countUpTo(terminalTimes, endOfDay);
    const windowStart = countUpTo(terminalTimes, endOfDay - windowMs);
    const windowCount = windowEnd - windowStart;
    let avgConfidence = 0;
    if (windowCount > 0) {
      let sum = 0;
      for (let i = windowStart; i < windowEnd; i++) sum += terminal[i].confidence;
      avgConfidence = sum / windowCount;
    }

    return {
      date,
      knowledgeNodes: countUpTo(nodeTimes, endOfDay),
      knowledgeEdges: countUpTo(edgeTimes, endOfDay),
      learningPatterns: countUpTo(patternTimes, endOfDay),
      experimentsCompleted: completedExpCount,
      successRate: totalExpCount > 0 ? completedExpCount / totalExpCount : 0,
      avgConfidence,
      promptImprovements: countUpTo(promptTimes, endOfDay),
    };
  });
}

/**
 * Calculates a day-by-day growth timeline for the specified period.
 *
 * @param period - Time window: '7d', '30d', or 'all' / 集計期間
 * @returns GrowthTimeline with per-day entries / 日次エントリを含むGrowthTimeline
 */
export async function getGrowthTimeline(
  period: '7d' | '30d' | 'all' = '30d',
): Promise<GrowthTimeline> {
  const now = new Date();
  let startDate: Date;

  switch (period) {
    case '7d':
      startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      break;
    case '30d':
      startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      break;
    case 'all': {
      const firstExperiment = await prisma.experiment.findFirst({
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      });
      startDate = firstExperiment?.createdAt ?? now;
      break;
    }
  }

  const dates: string[] = [];
  const currentDate = new Date(startDate);
  while (currentDate <= now) {
    dates.push(currentDate.toISOString().split('T')[0]);
    currentDate.setDate(currentDate.getDate() + 1);
  }

  const [nodes, edges, patterns, prompts, experiments] = await Promise.all([
    prisma.knowledgeGraphNode.findMany({ select: { createdAt: true } }),
    prisma.knowledgeGraphEdge.findMany({ select: { createdAt: true } }),
    prisma.learningPattern.findMany({ select: { createdAt: true } }),
    prisma.promptEvolution.findMany({ select: { createdAt: true } }),
    prisma.experiment.findMany({
      select: { createdAt: true, completedAt: true, status: true, confidence: true },
    }),
  ]);

  const timeline = computeGrowthTimeline(dates, {
    nodeDates: nodes.map((n) => n.createdAt),
    edgeDates: edges.map((e) => e.createdAt),
    patternDates: patterns.map((p) => p.createdAt),
    promptDates: prompts.map((p) => p.createdAt),
    experiments,
  });

  log.info({ period, totalDays: dates.length }, 'Growth timeline calculated');

  return { timeline, period, totalDays: dates.length };
}
