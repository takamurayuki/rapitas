/**
 * CrossProjectKnowledgeRoutes
 *
 * API endpoints for searching knowledge across all projects/themes.
 */
import { Elysia, t } from 'elysia';
import { searchCrossProjectKnowledge } from '../../services/memory/task-knowledge-extractor';
import { createLogger } from '../../config/logger';

const log = createLogger('routes:cross-project-knowledge');

export const crossProjectKnowledgeRoutes = new Elysia({ prefix: '/knowledge' })
  /**
   * Search knowledge across all projects with cross-project highlighting.
   */
  .get(
    '/cross-project',
    async (context) => {
      const { query } = context;
      try {
        const result = await searchCrossProjectKnowledge(
          query.q || '',
          query.excludeThemeId ? parseInt(query.excludeThemeId) : undefined,
          query.limit ? parseInt(query.limit) : 10,
        );

        return { success: true, data: result };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        log.error({ error: msg }, '[CrossProjectKnowledge] Search failed');
        return { success: false, error: msg };
      }
    },
    {
      query: t.Object({
        q: t.String(),
        excludeThemeId: t.Optional(t.String()),
        limit: t.Optional(t.String()),
      }),
    },
  );
