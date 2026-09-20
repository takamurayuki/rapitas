/**
 * PromptRecommendationRouter
 *
 * Read-only endpoint exposing recommendPromptVersion (task #970): given a
 * role, model and taskId, resolves the task's difficulty band and returns
 * which past prompt version performed best in that band, or explorationMode
 * when evidence is still too thin to trust.
 */
import { Elysia, t } from 'elysia';
import { prisma } from '../../config/database';
import { recommendPromptVersion } from '../../services/self-learning/comparison/prompt-version-history';

export const promptRecommendationRoutes = new Elysia({ prefix: '/self-learning' }).get(
  '/prompt-recommendation',
  async ({ query, set }) => {
    const taskId = parseInt(query.taskId, 10);
    if (!query.role || !query.model || !Number.isFinite(taskId)) {
      set.status = 400;
      return { error: 'role, model, taskId are required' };
    }

    const task = await prisma.task.findUnique({
      where: { id: taskId },
      select: { complexityScore: true },
    });
    if (!task) {
      set.status = 404;
      return { error: 'task not found' };
    }
    if (task.complexityScore == null) {
      set.status = 422;
      return { error: 'task has no complexityScore yet (research phase not complete)' };
    }

    const recommendation = await recommendPromptVersion(
      query.role,
      query.model,
      task.complexityScore,
    );
    return recommendation;
  },
  {
    query: t.Object({
      role: t.String(),
      model: t.String(),
      taskId: t.String(),
    }),
  },
);
