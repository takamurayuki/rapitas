/**
 * IdeaBox API Routes
 *
 * CRUD endpoints for the IdeaBox feature. Ideas are improvement suggestions
 * collected from agent execution, copilot chat, and manual user input.
 */
import { Elysia, t } from 'elysia';
import { createLogger } from '../../config/logger';
import {
  listIdeas,
  submitIdea,
  getIdeaStats,
} from '../../services/memory/idea-box-service';

const log = createLogger('routes:idea-box');

export const ideaBoxRoutes = new Elysia()

  /** List ideas with optional filters. */
  .get(
    '/idea-box',
    async ({ query }) => {
      const categoryId = query.categoryId ? parseInt(query.categoryId) : undefined;
      const unusedOnly = query.unusedOnly === 'true';
      const limit = query.limit ? parseInt(query.limit) : 20;
      const offset = query.offset ? parseInt(query.offset) : 0;

      const result = await listIdeas({ categoryId, unusedOnly, limit, offset });
      return result;
    },
    {
      query: t.Object({
        categoryId: t.Optional(t.String()),
        unusedOnly: t.Optional(t.String()),
        limit: t.Optional(t.String()),
        offset: t.Optional(t.String()),
      }),
    },
  )

  /** Submit a new idea manually. */
  .post(
    '/idea-box',
    async ({ body, set }) => {
      if (!body.title?.trim() || !body.content?.trim()) {
        set.status = 400;
        return { error: 'タイトルと内容は必須です' };
      }

      try {
        const id = await submitIdea({
          title: body.title.trim(),
          content: body.content.trim(),
          category: body.category ?? 'improvement',
          themeId: body.themeId ?? undefined,
          tags: body.tags ?? [],
          source: 'user',
          confidence: 0.8,
        });
        return { success: true, id };
      } catch (err) {
        log.error({ err }, 'Failed to submit idea');
        set.status = 500;
        return { error: 'アイデアの登録に失敗しました' };
      }
    },
    {
      body: t.Object({
        title: t.String({ minLength: 1 }),
        content: t.String({ minLength: 1 }),
        category: t.Optional(t.String()),
        themeId: t.Optional(t.Number()),
        tags: t.Optional(t.Array(t.String())),
      }),
    },
  )

  /** Get idea statistics by category. */
  .get(
    '/idea-box/stats',
    async ({ query }) => {
      const categoryId = query.categoryId ? parseInt(query.categoryId) : undefined;
      return getIdeaStats(categoryId);
    },
    {
      query: t.Object({
        categoryId: t.Optional(t.String()),
      }),
    },
  );
