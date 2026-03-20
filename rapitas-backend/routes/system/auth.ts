/**
 * Auth API Routes (re-export)
 *
 * This file is kept for backward compatibility.
 * The implementation has been split into sub-modules under ./auth/.
 */
export {
  authRoutes,
  authCoreRoutes,
  authSessionRoutes,
  googleOAuthRoutes,
  checkAuthRateLimit,
  AUTH_RATE_LIMIT,
  AUTH_RATE_WINDOW,
} from './auth/index';
