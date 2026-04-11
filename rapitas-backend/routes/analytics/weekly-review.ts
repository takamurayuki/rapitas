/**
 * Weekly Review API Routes (Tier S #3)
 *
 * Endpoints for the AI-generated weekly review feature. The actual
 * generation logic lives in services/ai/weekly-review-service.ts; this
 * file is a thin HTTP layer that handles request validation and the
 * idempotent generate-or-fetch flow.
 */
import { Elysia, t } from 'elysia';
import { prisma } from '../../config/database';
import { createLogger } from '../../config/logger';
import {
  generateWeeklyReview,
  getLatestWeeklyReview,
  getWeeklyReviews,
  deleteWeeklyReview,
} from '../../services/ai/weekly-review-service';

const log = createLogger('routes:weekly-review');

export const weeklyReviewRoutes = new Elysia()
  /**
   * List the most recent weekly reviews. Default limit 10, max 52.
   */
  .get(
    '/weekly-reviews',
    async ({ query }) => {
      const limit = query.limit ? parseInt(query.limit, 10) : 10;
      const reviews = await getWeeklyReviews(prisma, isNaN(limit) ? 10 : limit);
      return { success: true, reviews };
    },
    {
      query: t.Object({
        limit: t.Optional(t.String()),
      }),
      detail: {
        tags: ['Analytics', 'WeeklyReview'],
        summary: '週次レビュー一覧を取得',
      },
    },
  )

  /**
   * Get the most recent weekly review (single object).
   * Used by the /reports page card.
   */
  .get(
    '/weekly-reviews/latest',
    async () => {
      const review = await getLatestWeeklyReview(prisma);
      return { success: true, review };
    },
    {
      detail: {
        tags: ['Analytics', 'WeeklyReview'],
        summary: '最新の週次レビューを取得',
      },
    },
  )

  /**
   * Generate (or fetch existing) a weekly review for the given week.
   * If `weekStart` is omitted, defaults to LAST week.
   *
   * Idempotent: a `WeeklyReview` row already covering `weekStart` is
   * returned without re-calling Claude.
   */
  .post(
    '/weekly-reviews/generate',
    async ({ body, set }) => {
      try {
        const weekStart = body.weekStart ? new Date(body.weekStart) : undefined;
        if (weekStart && isNaN(weekStart.getTime())) {
          set.status = 400;
          return { success: false, error: 'Invalid weekStart date' };
        }
        const review = await generateWeeklyReview(prisma, weekStart);
        return { success: true, review };
      } catch (err) {
        log.error({ err }, 'Failed to generate weekly review');
        set.status = 500;
        return {
          success: false,
          error: err instanceof Error ? err.message : 'Generation failed',
        };
      }
    },
    {
      body: t.Object({
        weekStart: t.Optional(
          t.String({ description: 'ISO date for the Monday of the target week' }),
        ),
      }),
      detail: {
        tags: ['Analytics', 'WeeklyReview'],
        summary: '週次レビューを生成（または既存を返す）',
      },
    },
  )

  /**
   * Delete a weekly review by id. Used to force regeneration after a bad
   * Claude response or when stats change retroactively.
   */
  .delete(
    '/weekly-reviews/:id',
    async ({ params, set }) => {
      const id = parseInt(params.id, 10);
      if (isNaN(id)) {
        set.status = 400;
        return { success: false, error: 'Invalid id' };
      }
      try {
        await deleteWeeklyReview(prisma, id);
        return { success: true };
      } catch (err) {
        log.error({ err, id }, 'Failed to delete weekly review');
        set.status = 404;
        return { success: false, error: 'Not found' };
      }
    },
    {
      params: t.Object({ id: t.String() }),
      detail: {
        tags: ['Analytics', 'WeeklyReview'],
        summary: '週次レビューを削除',
      },
    },
  );
