/**
 * Daily Briefing API Route
 *
 * Generates an AI-powered daily plan based on the user's current tasks,
 * deadlines, work patterns, and IdeaBox items.
 */
import { Elysia, t } from 'elysia';
import { createLogger } from '../../config/logger';
import { generateDailyBriefing } from '../../services/ai/daily-briefing-service';

const log = createLogger('routes:daily-briefing');

export const dailyBriefingRoutes = new Elysia().get(
  '/daily-briefing',
  async ({ query }) => {
    try {
      const categoryId = query.categoryId ? parseInt(query.categoryId) : undefined;
      const briefing = await generateDailyBriefing(categoryId);
      return { success: true, briefing };
    } catch (err) {
      log.error({ err }, 'Failed to generate daily briefing');
      return {
        success: false,
        error: err instanceof Error ? err.message : 'ブリーフィングの生成に失敗しました',
      };
    }
  },
  {
    query: t.Object({
      categoryId: t.Optional(t.String()),
    }),
  },
);
