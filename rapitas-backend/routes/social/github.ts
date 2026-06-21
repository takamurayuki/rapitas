/**
 * GitHub Integration API Routes — Barrel
 *
 * Composes sub-route modules under the /github prefix and re-exports named
 * symbols expected by routes/index.ts, register-routes.ts, and index-optimized.ts.
 * Do not add route definitions here — place them in the routes/social/github/ subdirectory.
 */
import { Elysia } from 'elysia';
import { integrationRoutes } from './github/integrations';
import { pullRequestRoutes } from './github/pull-requests';
import { issueRoutes } from './github/issues';
import { ciActionRoutes } from './github/ci-actions';

export { taskGithubRoutes } from './github/task-github';

export const githubRoutes = new Elysia({ prefix: '/github' })
  .use(integrationRoutes)
  .use(pullRequestRoutes)
  .use(issueRoutes)
  .use(ciActionRoutes);
