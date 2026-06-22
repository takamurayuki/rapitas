/**
 * GitHub Integration API Routes — Barrel
 *
 * Composes sub-route modules under the /github prefix and re-exports named
 * symbols expected by routes/index.ts, register-routes.ts, and index-optimized.ts.
 * Do not add route definitions here — place them in the routes/social/github/ subdirectory.
 */
import { Elysia } from 'elysia';
import { integrationRoutes } from './github/integrations';
import { pullRequestReadRoutes } from './github/pull-requests-read';
import { pullRequestWriteRoutes } from './github/pull-requests-write';
import { issueRoutes } from './github/issues';
import { ciActionRoutes } from './github/ci-actions';

export { taskGithubRoutes } from './github/task-github';

export const githubRoutes = new Elysia({ prefix: '/github' })
  .use(integrationRoutes)
  .use(pullRequestReadRoutes)
  .use(pullRequestWriteRoutes)
  .use(issueRoutes)
  .use(ciActionRoutes);
