/**
 * Auth Routes (barrel)
 *
 * Assembles the full /auth route group from core routes, session management routes,
 * and Google OAuth routes. The named export `authRoutes` matches the original auth.ts
 * export so existing imports require no changes.
 */
import { Elysia } from 'elysia';
import { authCoreRoutes } from './routes';
import { authSessionRoutes } from './session-routes';
import { googleOAuthRoutes } from './google-oauth';

export { authCoreRoutes } from './routes';
export { authSessionRoutes } from './session-routes';
export { googleOAuthRoutes } from './google-oauth';
export { checkAuthRateLimit, AUTH_RATE_LIMIT, AUTH_RATE_WINDOW } from './rate-limiter';

/**
 * Combined authentication routes mounted under /auth prefix.
 */
export const authRoutes = new Elysia({ prefix: '/auth' })
  .use(authCoreRoutes)
  .use(authSessionRoutes)
  .use(googleOAuthRoutes);
