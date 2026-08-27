/**
 * Pareto Frontier Router
 *
 * Elysia sub-router for the multi-objective efficiency-frontier endpoints
 * under /agent-metrics/pareto-frontier. Parses and clamps query parameters,
 * then delegates to the pareto-frontier query module. Mounted by router.ts;
 * contains no business logic.
 */

import { Elysia } from 'elysia';
import { createLogger } from '../../../config/logger';
import {
  getParetoFrontier,
  getParetoRecommendation,
  type ComplexityFilter,
  type GoalKind,
  type ParetoFrontierOptions,
  type ParetoGoal,
} from './queries/pareto-frontier';

const log = createLogger('routes:agent-metrics:pareto');

const COMPLEXITY_FILTERS: readonly ComplexityFilter[] = ['all', 'low', 'medium', 'high'];
const GOAL_KINDS: readonly GoalKind[] = ['successRate', 'throughput', 'cost'];
const DEFAULT_WINDOW_DAYS = 30;
const MAX_WINDOW_DAYS = 90;

/**
 * Reads the shared window/filter parameters, clamping to safe ranges.
 *
 * @param query - Raw Elysia query object / クエリ
 * @returns Frontier options / 集計条件
 */
export function parseFrontierOptions(query: Record<string, unknown>): ParetoFrontierOptions {
  const days = parseInt(String(query.days ?? ''), 10);
  const band = String(query.complexityBand ?? 'all') as ComplexityFilter;
  const role = String(query.role ?? 'all').trim() || 'all';
  return {
    windowDays: Math.min(
      MAX_WINDOW_DAYS,
      Math.max(1, Number.isFinite(days) ? days : DEFAULT_WINDOW_DAYS),
    ),
    complexityBand: COMPLEXITY_FILTERS.includes(band) ? band : 'all',
    role,
  };
}

/**
 * Reads the goal parameters; returns null when the goal is malformed.
 *
 * @param query - Raw Elysia query object / クエリ
 * @returns Goal, or null / 目標
 */
export function parseGoal(query: Record<string, unknown>): ParetoGoal | null {
  const kind = String(query.goal ?? '') as GoalKind;
  const value = parseFloat(String(query.value ?? ''));
  if (!GOAL_KINDS.includes(kind) || !Number.isFinite(value) || value < 0) return null;
  if (kind === 'successRate' && value > 100) return null;
  return { kind, value };
}

export const paretoFrontierRouter = new Elysia({ prefix: '/pareto-frontier' })
  /**
   * Per-segment Pareto frontier over execution time / success rate / cost
   * with 95% confidence intervals. Powers the /agents/pareto dashboard.
   */
  .get('/', async ({ query }) => {
    try {
      const data = await getParetoFrontier(parseFrontierOptions(query));
      return { success: true, data };
    } catch (error) {
      log.error({ err: error }, 'Error computing pareto frontier');
      return { success: false, error: 'Failed to compute pareto frontier' };
    }
  })

  /**
   * Goal-driven parameter-set recommendation (e.g. goal=successRate&value=95
   * or goal=throughput&value=20) with projected monthly cost/time deltas.
   */
  .get('/recommend', async ({ query, set }) => {
    const goal = parseGoal(query);
    if (!goal) {
      set.status = 400;
      return {
        success: false,
        error: 'Invalid goal: expected goal=successRate|throughput|cost and a non-negative value',
      };
    }
    try {
      const data = await getParetoRecommendation(parseFrontierOptions(query), goal);
      return { success: true, data };
    } catch (error) {
      log.error({ err: error }, 'Error computing pareto recommendation');
      return { success: false, error: 'Failed to compute pareto recommendation' };
    }
  });
