/**
 * AUTO-GENERATED — DO NOT EDIT.
 *
 * Run `bun run generate:route-barrels` to regenerate from
 * routes/route-barrel-legacy-manifest.json + *.routes.ts auto-discovery
 * (see scripts/generate-route-barrels.cjs).
 */
import { Elysia } from 'elysia';
import { categoriesRoutes } from './categories';
import { themesRoutes } from './themes';
import { themeRepoInitRoutes } from './theme-repo-init';
import { labelsRoutes } from './labels';
import { taskLabelsRoutes } from './labels';
import { projectsRoutes } from './projects';
import { milestonesRoutes } from './milestones';
import { templatesRoutes } from './templates';

export { categoriesRoutes } from './categories';
export { themesRoutes } from './themes';
export { themeRepoInitRoutes } from './theme-repo-init';
export { labelsRoutes } from './labels';
export { taskLabelsRoutes } from './labels';
export { projectsRoutes } from './projects';
export { milestonesRoutes } from './milestones';
export { templatesRoutes } from './templates';

export const organizationDomainRoutes = new Elysia()
  .use(categoriesRoutes)
  .use(themesRoutes)
  .use(themeRepoInitRoutes)
  .use(labelsRoutes)
  .use(taskLabelsRoutes)
  .use(projectsRoutes)
  .use(milestonesRoutes)
  .use(templatesRoutes);
