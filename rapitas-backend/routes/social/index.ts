// Routes Social barrel export — 集約 + ドメイン単位マージ済みインスタンス
import { Elysia } from 'elysia';
import { commentsRoutes } from './comments';
import { githubRoutes, taskGithubRoutes } from './github';

export { commentsRoutes } from './comments';
export { githubRoutes, taskGithubRoutes } from './github';

export const socialDomainRoutes = new Elysia()
  .use(commentsRoutes)
  .use(githubRoutes)
  .use(taskGithubRoutes);
