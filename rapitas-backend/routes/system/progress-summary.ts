/**
 * ProgressSummaryRoutes
 *
 * API endpoints for AI-generated progress summaries.
 */
import { Elysia, t } from 'elysia';
import { generateProgressSummary } from '../../services/analytics/progress-summary-service';

export const progressSummaryRoutes = new Elysia({ prefix: '/progress' })
  /**
   * Generate a progress summary for recent completed tasks.
   */
  .get(
    '/summary',
    async (context) => {
      const { query } = context;
      try {
        const days = query.days ? parseInt(query.days) : 7;
        const summary = await generateProgressSummary(days);

        return {
          success: true,
          data: summary,
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          success: false,
          error: errorMessage,
        };
      }
    },
    {
      query: t.Object({
        days: t.Optional(t.String()),
      }),
    },
  );
