/**
 * AUTO-GENERATED — DO NOT EDIT.
 *
 * Run `bun run generate:route-barrels` to regenerate from
 * routes/route-barrel-legacy-manifest.json + *.routes.ts auto-discovery
 * (see scripts/generate-route-barrels.cjs).
 */
import { Elysia } from 'elysia';
import { examGoalsRoutes } from './exam-goals';
import { studyStreaksRoutes } from './study-streaks';
import { learningGoalsRoutes } from './learning-goals';
import { resourcesRoutes } from './resources';
import { learningDashboardRouter } from './learning-dashboard';
import { vocabDecksRoutes } from './vocab-decks';
import { studyGoalsRoutes } from './study-goals';
import { studySessionsRoutes } from './study-sessions';

export { examGoalsRoutes } from './exam-goals';
export { studyStreaksRoutes } from './study-streaks';
export { learningGoalsRoutes } from './learning-goals';
export { resourcesRoutes } from './resources';
export { learningDashboardRouter } from './learning-dashboard';
export { vocabDecksRoutes } from './vocab-decks';
export { studyGoalsRoutes } from './study-goals';
export { studySessionsRoutes } from './study-sessions';

export const learningDomainRoutes = new Elysia()
  .use(examGoalsRoutes)
  .use(studyStreaksRoutes)
  .use(learningGoalsRoutes)
  .use(resourcesRoutes)
  .use(learningDashboardRouter)
  .use(vocabDecksRoutes)
  .use(studyGoalsRoutes)
  .use(studySessionsRoutes);
