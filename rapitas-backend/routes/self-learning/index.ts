/**
 * AUTO-GENERATED — DO NOT EDIT.
 *
 * Run `bun run generate:route-barrels` to regenerate from
 * routes/route-barrel-legacy-manifest.json + *.routes.ts auto-discovery
 * (see scripts/generate-route-barrels.cjs).
 */
import { Elysia } from 'elysia';
import { experimentsRoutes } from './experiments';
import { hypothesisExperimentsRoutes } from './hypothesis-experiments';
import { knowledgeGraphRoutes } from './knowledge-graph';
import { learningRoutes } from './learning';
import { promptRecommendationRoutes } from './prompt-recommendation-router';

export { experimentsRoutes } from './experiments';
export { hypothesisExperimentsRoutes } from './hypothesis-experiments';
export { knowledgeGraphRoutes } from './knowledge-graph';
export { learningRoutes } from './learning';
export { promptRecommendationRoutes } from './prompt-recommendation-router';

export const selfLearningDomainRoutes = new Elysia()
  .use(experimentsRoutes)
  .use(hypothesisExperimentsRoutes)
  .use(knowledgeGraphRoutes)
  .use(learningRoutes)
  .use(promptRecommendationRoutes);
