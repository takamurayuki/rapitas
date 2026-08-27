/**
 * AUTO-GENERATED — DO NOT EDIT.
 *
 * Run `bun run generate:route-barrels` to regenerate from
 * routes/route-barrel-legacy-manifest.json + *.routes.ts auto-discovery
 * (see scripts/generate-route-barrels.cjs).
 */
import { Elysia } from 'elysia';
import { settingsRoutes } from './settings';
import { authRoutes } from './auth';
import { sseRoutes } from './sse';
import { developerModeRoutes } from './developer-mode';
import { notificationsRoutes } from './notifications';
import { memosRoutes } from './memos';
import { searchRoutes } from './search';
import { urlMetadataRoutes } from './url-metadata';
import { directoriesRoutes } from './directories';
import { smartActionRoutes } from './smart-action';
import { localLLMRouter } from './local-llm';
import { transcribeRouter } from './transcribe';
import { mcpRoutes } from './mcp';
import { gitCleanupRoutes } from './git-cleanup';
import { backupsRoutes } from './backups';
import { errorsRoutes } from './errors';
import { setupRoutes } from './setup';
import { exportRoutes } from './export';
import { importRoutes } from './import';
import { rateLimitRoutes } from './monitoring/rate-limits';
import { progressSummaryRoutes } from './monitoring/progress-summary';
import { techDebtRoutes } from './monitoring/tech-debt';
import { temporalDebugRoutes } from './monitoring/temporal-debug';
import { projectHealthRoutes } from './monitoring/project-health';
import { debugLogsRouter } from './monitoring/debug-logs';
import { gitCacheMetricsRoutes } from './monitoring/git-cache-metrics';
import { ciTimingRoutes } from './monitoring/ci-timing';

export { settingsRoutes } from './settings';
export { authRoutes } from './auth';
export { sseRoutes } from './sse';
export { developerModeRoutes } from './developer-mode';
export { notificationsRoutes } from './notifications';
export { memosRoutes } from './memos';
export { searchRoutes } from './search';
export { urlMetadataRoutes } from './url-metadata';
export { directoriesRoutes } from './directories';
export { smartActionRoutes } from './smart-action';
export { localLLMRouter } from './local-llm';
export { transcribeRouter } from './transcribe';
export { mcpRoutes } from './mcp';
export { gitCleanupRoutes } from './git-cleanup';
export { backupsRoutes } from './backups';
export { errorsRoutes } from './errors';
export { setupRoutes } from './setup';
export { exportRoutes } from './export';
export { importRoutes } from './import';
export { rateLimitRoutes } from './monitoring/rate-limits';
export { progressSummaryRoutes } from './monitoring/progress-summary';
export { techDebtRoutes } from './monitoring/tech-debt';
export { temporalDebugRoutes } from './monitoring/temporal-debug';
export { projectHealthRoutes } from './monitoring/project-health';
export { debugLogsRouter } from './monitoring/debug-logs';
export { gitCacheMetricsRoutes } from './monitoring/git-cache-metrics';
export { ciTimingRoutes } from './monitoring/ci-timing';

export const systemDomainRoutes = new Elysia()
  .use(settingsRoutes)
  .use(authRoutes)
  .use(sseRoutes)
  .use(developerModeRoutes)
  .use(notificationsRoutes)
  .use(memosRoutes)
  .use(searchRoutes)
  .use(urlMetadataRoutes)
  .use(directoriesRoutes)
  .use(smartActionRoutes)
  .use(localLLMRouter)
  .use(transcribeRouter)
  .use(mcpRoutes)
  .use(gitCleanupRoutes)
  .use(backupsRoutes)
  .use(errorsRoutes)
  .use(setupRoutes)
  .use(exportRoutes)
  .use(importRoutes)
  .use(rateLimitRoutes)
  .use(progressSummaryRoutes)
  .use(techDebtRoutes)
  .use(temporalDebugRoutes)
  .use(projectHealthRoutes)
  .use(debugLogsRouter)
  .use(gitCacheMetricsRoutes)
  .use(ciTimingRoutes);
