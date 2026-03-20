/**
 * Auth Session Routes
 *
 * Session management endpoints: list active sessions, delete a specific session,
 * and admin-only cleanup of all expired sessions.
 */
import { Elysia } from 'elysia';
import { prisma } from '../../../config/database';
import { createLogger } from '../../../config/logger';

const log = createLogger('routes:auth:session');

/**
 * Route group for session management (list / delete / cleanup).
 * Mounted under /auth prefix via the parent authRoutes.
 */
export const authSessionRoutes = new Elysia()

  .get('/sessions', async ({ cookie: { sessionToken }, set }) => {
    try {
      const token = sessionToken.value;

      if (!token) {
        set.status = 401;
        return { success: false, message: 'No session token' };
      }

      const currentSession = await prisma.userSession.findFirst({
        where: { sessionToken: token, expiresAt: { gt: new Date() } },
        include: { user: true },
      });

      if (!currentSession) {
        set.status = 401;
        return { success: false, message: 'Invalid session' };
      }

      const sessions = await prisma.userSession.findMany({
        where: { userId: currentSession.user.id, expiresAt: { gt: new Date() } },
        orderBy: { createdAt: 'desc' },
      });

      return {
        success: true,
        sessions: sessions.map((session) => ({
          id: session.id,
          isCurrentSession: session.sessionToken === token,
          createdAt: session.createdAt,
          expiresAt: session.expiresAt,
        })),
      };
    } catch (error) {
      log.error({ err: error }, 'Get sessions error');
      set.status = 500;
      return { success: false, message: 'Internal server error getting sessions' };
    }
  })

  .delete('/sessions/:sessionId', async ({ params, cookie: { sessionToken }, set }) => {
    try {
      const token = sessionToken.value;
      const { sessionId } = params;

      if (!token) {
        set.status = 401;
        return { success: false, message: 'No session token' };
      }

      const currentSession = await prisma.userSession.findFirst({
        where: { sessionToken: token, expiresAt: { gt: new Date() } },
        include: { user: true },
      });

      if (!currentSession) {
        set.status = 401;
        return { success: false, message: 'Invalid session' };
      }

      const sessionIdNum = parseInt(sessionId);
      if (isNaN(sessionIdNum)) {
        set.status = 400;
        return { success: false, message: 'Invalid session ID' };
      }

      const result = await prisma.userSession.deleteMany({
        where: { id: sessionIdNum, userId: currentSession.user.id },
      });

      if (result.count === 0) {
        set.status = 404;
        return { success: false, message: 'Session not found' };
      }

      return { success: true, message: 'Session deleted successfully' };
    } catch (error) {
      log.error({ err: error }, 'Delete session error');
      set.status = 500;
      return { success: false, message: 'Internal server error deleting session' };
    }
  })

  .post('/cleanup-sessions', async ({ cookie: { sessionToken }, set }) => {
    try {
      const token = sessionToken.value;

      if (!token) {
        set.status = 401;
        return { success: false, message: 'Authentication required' };
      }

      const currentSession = await prisma.userSession.findFirst({
        where: { sessionToken: token, expiresAt: { gt: new Date() } },
        include: { user: true },
      });

      if (!currentSession || currentSession.user.role !== 'admin') {
        set.status = 403;
        return { success: false, message: 'Admin access required' };
      }

      const result = await prisma.userSession.deleteMany({
        where: { expiresAt: { lt: new Date() } },
      });

      return {
        success: true,
        message: `Cleaned up ${result.count} expired sessions`,
      };
    } catch (error) {
      log.error({ err: error }, 'Cleanup sessions error');
      set.status = 500;
      return { success: false, message: 'Internal server error during cleanup' };
    }
  });
