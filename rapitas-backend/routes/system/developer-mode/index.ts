/**
 * DeveloperMode Routes (barrel)
 *
 * Re-exports all developer mode route groups and assembles the combined export
 * used as a drop-in replacement for the original single-file module.
 */
import { Elysia } from 'elysia';
import { developerModeConfigRoutes } from './config-routes';
import { developerModeAnalyzeRoute } from './analyze-route';
import { developerModePromptRoutes } from './prompt-routes';

export { developerModeConfigRoutes } from './config-routes';
export { developerModeAnalyzeRoute } from './analyze-route';
export { developerModePromptRoutes } from './prompt-routes';

/**
 * Combined developer mode routes — maintains the same export name as the
 * original developer-mode.ts so existing imports continue to work.
 */
export const developerModeRoutes = new Elysia()
  .use(developerModeConfigRoutes)
  .use(developerModeAnalyzeRoute)
  .use(developerModePromptRoutes);
