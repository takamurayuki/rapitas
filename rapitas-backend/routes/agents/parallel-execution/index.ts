/**
 * ParallelExecutionRoutes (index)
 *
 * Composes analysis, execution, session, and PR sub-routers into the single
 * Elysia app exported as `parallelExecutionRoutes`. All routes are mounted
 * under the `/parallel` prefix defined here.
 */
import { Elysia } from 'elysia';
import { analysisRoutes } from './analysis-routes';
import { executeRoutes } from './execute-routes';
import { buildSessionRoutes } from './session-routes';
import { prRoutes } from './pr-routes';
import { getParallelExecutor } from './executor-singleton';

export const parallelExecutionRoutes = new Elysia({ prefix: '/parallel' })
  .use(analysisRoutes)
  .use(executeRoutes)
  .use(buildSessionRoutes(getParallelExecutor))
  .use(prRoutes);

// Re-export helpers for any consumers that import them from this sub-package
export { buildAnalysisInput, extractFilePaths } from './analysis-helpers';
export { buildPRBody, readWorkflowFile } from './pr-helpers';
export { getParallelExecutor } from './executor-singleton';
