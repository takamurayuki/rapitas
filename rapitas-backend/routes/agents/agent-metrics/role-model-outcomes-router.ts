/**
 * Role Model Outcomes Router
 *
 * Elysia sub-router (mounted under /agent-metrics) for "which model ran which
 * workflow phase, and what did the task do next". Thin layer: parses the
 * window and delegates.
 *
 * Distinct from /cost-optimization and /pareto-frontier, which score a model
 * on `status === 'completed'` — the CLI exiting cleanly. Measured 2026-10-21
 * over 500 executions that axis is saturated: every reliable point sits
 * between 91.7% and 100% with every interval overlapping, so it cannot say
 * whether a cheaper model implements the requirement as faithfully. The
 * repair loop does vary (37 `verify_repair` transitions against 59 verify
 * saves in the same fortnight), so that is what this scores on.
 */

import { Elysia } from 'elysia';
import { createLogger } from '../../../config/logger';
import { getRoleModelOutcomes } from './queries/role-model-outcomes';

const log = createLogger('routes:agent-metrics:role-model-outcomes');

const DEFAULT_DAYS = 14;
const MAX_DAYS = 90;

export const roleModelOutcomesRouter = new Elysia({ prefix: '/role-model-outcomes' }).get(
  '/',
  async ({ query }) => {
    try {
      const requested = parseInt((query as { days?: string }).days ?? '', 10);
      const days = Math.min(
        MAX_DAYS,
        Math.max(1, Number.isFinite(requested) ? requested : DEFAULT_DAYS),
      );
      return { success: true, data: await getRoleModelOutcomes({ days }) };
    } catch (error) {
      log.error({ err: error }, 'Error computing role/model outcomes');
      return { error: 'Failed to compute role/model outcomes' };
    }
  },
);
