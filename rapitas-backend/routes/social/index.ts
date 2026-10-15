/**
 * AUTO-GENERATED — DO NOT EDIT.
 *
 * Run `bun run generate:route-barrels` to regenerate from
 * routes/route-barrel-legacy-manifest.json + *.routes.ts auto-discovery
 * (see scripts/generate-route-barrels.cjs).
 */
import { Elysia } from 'elysia';
import { commentsRoutes } from './comments';
import { githubRoutes } from './github';
import { taskGithubRoutes } from './github';

export { commentsRoutes } from './comments';
export { githubRoutes } from './github';
export { taskGithubRoutes } from './github';

export const socialDomainRoutes = new Elysia()
  .use(commentsRoutes)
  .use(githubRoutes)
  .use(taskGithubRoutes);
