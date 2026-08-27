// Routes AI barrel export — 集約 + ドメイン単位マージ済みインスタンス
import { Elysia } from 'elysia';
import { aiChatRoutes } from './ai-chat';
import { copilotChatRoutes } from './copilot-chat';
import { promptsRoutes } from './prompts';
import { systemPromptsRoutes } from './system-prompts';

export { aiChatRoutes } from './ai-chat';
export { copilotChatRoutes } from './copilot-chat';
export { promptsRoutes } from './prompts';
export { systemPromptsRoutes } from './system-prompts';

export const aiDomainRoutes = new Elysia()
  .use(aiChatRoutes)
  .use(copilotChatRoutes)
  .use(promptsRoutes)
  .use(systemPromptsRoutes);
