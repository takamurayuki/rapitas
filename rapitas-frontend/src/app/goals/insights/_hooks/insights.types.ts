/**
 * insights.types
 *
 * Shapes of GET /goal-insights, mirroring rapitas-backend/services/goals/goal-insights.ts.
 */

/** One metric: a rate with the counts behind it. */
export interface InsightMetric {
  numerator: number;
  denominator: number;
  /** null = no material (denominator 0), which must never be shown as 0%. */
  rate: number | null;
  reason: 'no-material' | 'no-reflection-source' | null;
}

/** The four metrics of one scope. */
export interface InsightMetrics {
  reachRate: InsightMetric;
  resumeRate: InsightMetric;
  quality: InsightMetric;
  feltProgress: InsightMetric;
}

/** Aggregation window. */
export type InsightPeriod = '4w' | 'all';

/** One goal in the per-goal list. */
export interface InsightGoalRow {
  id: number;
  name: string;
  reached: number;
  open: number;
  paused: number;
  /** ISO time of the latest update. */
  lastUpdatedAt: string;
  stalled: boolean;
}

/** GET /goal-insights response. */
export interface InsightsResponse {
  period: InsightPeriod;
  overall: InsightMetrics;
  goals: InsightGoalRow[];
}
