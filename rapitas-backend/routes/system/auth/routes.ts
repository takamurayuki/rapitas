/**
 * Auth Core Routes
 *
 * Core authentication endpoints: register, login, logout, and current-user lookup.
 * Session management lives in session-routes.ts; Google OAuth in google-oauth.ts.
 */
import { Elysia, t } from 'elysia';
import { prisma } from '../../../config/database';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { createLogger } from '../../../config/logger';
import { checkAuthRateLimit } from './rate-limiter';
import { resolveSessionByToken } from '../../../services/core/auth-session-resolver';
import { resolveUserByUsernameOrEmail } from '../../../services/core/user-resolver';
import { ensureWorkspaceForUser } from '../../../services/tenancy/workspace-provisioning';
import {
  clearSessionWorkspaceCache,
  forgetSessionWorkspace,
} from '../../../services/tenancy/session-workspace';

const log = createLogger('routes:auth:core');

/**
 * Core authentication routes: register, login, logout, /me.
 * Mounted under /auth prefix via the parent authRoutes barrel.
 */
export const authCoreRoutes = new Elysia()

  .post(
    '/register',
    async ({ body, set, cookie: { sessionToken }, request }) => {
      try {
        const clientIp = request.headers.get('x-forwarded-for') || 'unknown';
        if (!checkAuthRateLimit(`register:${clientIp}`)) {
          set.status = 429;
          return {
            success: false,
            message: 'Too many registration attempts. Please try again later.',
          };
        }

        const { username, email, password } = body as {
          username: string;
          email: string;
          password: string;
        };

        const existingUser = await resolveUserByUsernameOrEmail(username, email);

        if (existingUser) {
          set.status = 409;
          return {
            success: false,
            message:
              existingUser.username === username
                ? 'Username already exists'
                : 'Email already exists',
          };
        }

        const saltRounds = 12;
        const hashedPassword = await bcrypt.hash(password, saltRounds);

        const user = await prisma.user.create({
          data: { username, email, passwordHash: hashedPassword, role: 'user' },
        });

        // Before the session exists, so the account can never be signed in
        // without a workspace — a user with none resolves to "no workspace",
        // which means they would see everyone's data instead of their own.
        const workspace = await ensureWorkspaceForUser(user.id, username);

        const token = randomBytes(32).toString('hex');
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

        await prisma.userSession.create({
          data: { userId: user.id, sessionToken: token, expiresAt },
        });

        sessionToken.set({
          value: token,
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'strict',
          maxAge: 24 * 60 * 60,
        });

        return {
          success: true,
          message: 'User registered successfully',
          user: {
            id: user.id,
            username: user.username,
            email: user.email,
            role: user.role,
            createdAt: user.createdAt.toISOString(),
            lastLoginAt: null,
          },
          workspace,
        };
      } catch (error) {
        log.error({ err: error }, 'Registration error');
        set.status = 500;
        return { success: false, message: 'Internal server error during registration' };
      }
    },
    {
      body: t.Object({
        username: t.String({ minLength: 3, maxLength: 50 }),
        email: t.String({ format: 'email' }),
        password: t.String({ minLength: 8 }),
      }),
    },
  )

  .post(
    '/login',
    async ({ body, set, cookie: { sessionToken }, request }) => {
      try {
        const clientIp = request.headers.get('x-forwarded-for') || 'unknown';
        if (!checkAuthRateLimit(`login:${clientIp}`)) {
          set.status = 429;
          return { success: false, message: 'Too many login attempts. Please try again later.' };
        }

        const { username, password } = body as { username: string; password: string };

        // NOTE: username field may contain either a username or an email address — allow both.
        const user = await resolveUserByUsernameOrEmail(username, username);

        if (!user || !user.passwordHash) {
          set.status = 401;
          return { success: false, message: 'Invalid credentials' };
        }

        const isValidPassword = await bcrypt.compare(password, user.passwordHash);
        if (!isValidPassword) {
          set.status = 401;
          return { success: false, message: 'Invalid credentials' };
        }

        // Accounts that predate tenancy have no workspace, and a signed-in
        // user without one resolves to "no workspace" — which means they see
        // everyone's data. Provisioning on login closes that for them without
        // a migration. Idempotent, so an existing member keeps their own.
        const workspace = await ensureWorkspaceForUser(user.id, user.username);

        const token = randomBytes(32).toString('hex');
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

        await prisma.userSession.create({
          data: { userId: user.id, sessionToken: token, expiresAt },
        });

        sessionToken.set({
          value: token,
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'strict',
          maxAge: 24 * 60 * 60,
        });

        await prisma.user.update({
          where: { id: user.id },
          data: { lastLoginAt: new Date() },
        });

        // A token is reused after a logout+login only in tests, but a stale
        // cached answer would scope the new session to the old workspace.
        clearSessionWorkspaceCache();

        return {
          success: true,
          message: 'Login successful',
          token: token,
          workspace,
          user: {
            id: user.id,
            username: user.username,
            email: user.email,
            role: user.role,
            createdAt: user.createdAt.toISOString(),
            lastLoginAt: user.lastLoginAt?.toISOString() || null,
          },
        };
      } catch (error) {
        log.error({ err: error }, 'Login error');
        set.status = 500;
        return { success: false, message: 'Internal server error during login' };
      }
    },
    {
      body: t.Object({
        username: t.String(),
        password: t.String(),
      }),
    },
  )

  .post('/logout', async ({ cookie: { sessionToken }, set }) => {
    try {
      const token = sessionToken.value;

      if (token) {
        await prisma.userSession.deleteMany({ where: { sessionToken: token } });
        sessionToken.remove();
        // Otherwise the token keeps resolving to its workspace for up to the
        // cache TTL after the session row is gone. The cookie value is typed
        // as `{}` by Elysia without a cookie schema, so narrow it here rather
        // than widen the cache's signature.
        if (typeof token === 'string') forgetSessionWorkspace(token);
      }

      return { success: true, message: 'Logged out successfully' };
    } catch (error) {
      log.error({ err: error }, 'Logout error');
      set.status = 500;
      return { success: false, message: 'Internal server error during logout' };
    }
  })

  .get('/me', async ({ cookie: { sessionToken }, set }) => {
    try {
      const token = sessionToken.value as string | undefined;

      if (!token) {
        set.status = 401;
        return { success: false, message: 'No session token' };
      }

      const session = await resolveSessionByToken(String(token));

      if (!session) {
        set.status = 401;
        return { success: false, message: 'Invalid or expired session' };
      }

      return {
        success: true,
        user: {
          id: session.user.id,
          username: session.user.username,
          email: session.user.email,
          role: session.user.role,
          lastLoginAt: session.user.lastLoginAt,
        },
      };
    } catch (error) {
      log.error({ err: error }, 'Get user error');
      set.status = 500;
      return { success: false, message: 'Internal server error getting user info' };
    }
  });
