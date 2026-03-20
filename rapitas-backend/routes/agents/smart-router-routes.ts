/**
 * SmartRouterRoutes
 *
 * API endpoints for cost prediction, smart model routing, and budget management.
 */
import { Elysia, t } from 'elysia';
import {
  estimateCost,
  getSmartRoute,
  getBudgetStatus,
} from '../../services/smart-model-router';
import { createLogger } from '../../config/logger';

const log = createLogger('routes:smart-router');

export const smartRouterRoutes = new Elysia({ prefix: '/smart-router' })
  /**
   * Get smart model recommendation for a task.
   */
  .get(
    '/recommend/:taskId',
    async (context) => {
      const { params, query } = context;
      try {
        const taskId = parseInt(params.taskId);
        const budget = query.weeklyBudget ? parseFloat(query.weeklyBudget) : null;
        const decision = await getSmartRoute(taskId, budget);

        return { success: true, data: decision };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        log.error({ error: msg }, '[SmartRouter] Recommendation failed');
        return { success: false, error: msg };
      }
    },
    {
      params: t.Object({ taskId: t.String() }),
      query: t.Object({ weeklyBudget: t.Optional(t.String()) }),
    },
  )

  /**
   * Estimate cost for a specific model and complexity.
   */
  .get(
    '/estimate',
    async (context) => {
      const { query } = context;
      try {
        const complexity = parseFloat(query.complexity || '50');
        const modelId = query.modelId || 'claude-sonnet-4-6-20250610';
        const estimate = await estimateCost(complexity, modelId);

        return { success: true, data: estimate };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { success: false, error: msg };
      }
    },
    {
      query: t.Object({
        complexity: t.Optional(t.String()),
        modelId: t.Optional(t.String()),
      }),
    },
  )

  /**
   * Get current budget status.
   */
  .get(
    '/budget',
    async (context) => {
      const { query } = context;
      try {
        const budget = query.weeklyBudget ? parseFloat(query.weeklyBudget) : null;
        const status = await getBudgetStatus(budget);

        return { success: true, data: status };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return { success: false, error: msg };
      }
    },
    {
      query: t.Object({ weeklyBudget: t.Optional(t.String()) }),
    },
  );
