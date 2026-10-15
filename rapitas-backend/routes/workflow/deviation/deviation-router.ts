/**
 * deviation-router
 *
 * Route definitions for the plan-deviation timeline (task 1218). Thin layer —
 * validation and loading live in deviation-handlers.ts.
 */
import { Elysia } from 'elysia';
import {
  handleGetDeviationContext,
  handleGetDeviationTimeline,
  handlePostDeviationAudit,
} from './deviation-handlers';
import { createDefaultDeviationDeps, type DeviationDeps } from './deviation-deps';

/**
 * Build the deviation routes under the `/workflow` prefix.
 *
 * @param deps - Data access (tests inject fakes) / 依存
 * @returns Elysia plugin with the three deviation endpoints / ルート群
 */
export function createDeviationRoutes(deps?: DeviationDeps) {
  const resolveDeps = () => deps ?? createDefaultDeviationDeps();
  return new Elysia({ prefix: '/workflow' })
    .get('/tasks/:taskId/deviation-timeline', (ctx) =>
      handleGetDeviationTimeline(
        {
          params: ctx.params as { taskId: string },
          query: ctx.query as { executionId?: string },
          set: ctx.set as { status: number },
        },
        resolveDeps(),
      ),
    )
    .get('/executions/:executionId/deviation-context', (ctx) =>
      handleGetDeviationContext(
        {
          params: ctx.params as { executionId: string },
          query: ctx.query as { seq?: string; before?: string; after?: string },
          set: ctx.set as { status: number },
        },
        resolveDeps(),
      ),
    )
    .post('/tasks/:taskId/deviation-audit', (ctx) =>
      handlePostDeviationAudit(
        {
          params: ctx.params as { taskId: string },
          body: ctx.body,
          headers: ctx.headers as Record<string, string | undefined>,
          set: ctx.set as { status: number },
        },
        resolveDeps(),
      ),
    );
}

/** Production deviation routes (Prisma-backed). */
export const deviationRoutes = createDeviationRoutes();
