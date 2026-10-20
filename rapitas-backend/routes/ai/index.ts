/**
 * AUTO-GENERATED — DO NOT EDIT.
 *
 * Run `bun run generate:route-barrels` to regenerate from
 * routes/route-barrel-legacy-manifest.json + *.routes.ts auto-discovery
 * (see scripts/generate-route-barrels.cjs).
 */
import { Elysia } from 'elysia';
import { aiChatRoutes } from './ai-chat';
import { copilotChatRoutes } from './copilot-chat';
import { promptsRoutes } from './prompts';
import { systemPromptsRoutes } from './system-prompts';
import assistantCleanupRoute from './assistant-cleanup.routes';
import assistantIntakeRoute from './assistant-intake.routes';
import assistantQueryRoute from './assistant-query.routes';

export { aiChatRoutes } from './ai-chat';
export { copilotChatRoutes } from './copilot-chat';
export { promptsRoutes } from './prompts';
export { systemPromptsRoutes } from './system-prompts';

export const aiDomainRoutes = new Elysia()
  .use(aiChatRoutes)
  .use(copilotChatRoutes)
  .use(promptsRoutes)
  .use(systemPromptsRoutes)
  .use(assistantCleanupRoute)
  .use(assistantIntakeRoute)
  .use(assistantQueryRoute);
