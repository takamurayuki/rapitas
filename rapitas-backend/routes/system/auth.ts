import { Elysia, t } from 'elysia';
import { prisma } from '../../config/database';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { google } from 'googleapis';
import { createLogger } from '../../config/logger';

const log = createLogger('routes:auth');

// Simple in-memory rate limiter for auth endpoints
const authAttempts = new Map<string, { count: number; resetAt: number }>();
const AUTH_RATE_LIMIT = 5; // max attempts
const AUTH_RATE_WINDOW = 60 * 1000; // 1 minute window

function checkAuthRateLimit(identifier: string): boolean {
  const now = Date.now();
  const entry = authAttempts.get(identifier);
  if (!entry || now > entry.resetAt) {
    authAttempts.set(identifier, { count: 1, resetAt: now + AUTH_RATE_WINDOW });
    return true;
  }
  if (entry.count >= AUTH_RATE_LIMIT) {
    return false;
  }
  entry.count++;
  return true;
}

// Cleanup old entries periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of authAttempts) {
    if (now > entry.resetAt) authAttempts.delete(key);
  }
}, 5 * 60 * 1000);

// Google OAuth2 configuration
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_CALLBACK_URL || 'http://localhost:3000/auth/google/callback'
);

const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile'
];

export const authRoutes = new Elysia({ prefix: '/auth' })
  .post('/register', async ({ body, set, cookie: { sessionToken }, request }) => {
    try {
      const clientIp = request.headers.get('x-forwarded-for') || 'unknown';
      if (!checkAuthRateLimit(`register:${clientIp}`)) {
        set.status = 429;
        return { success: false, message: 'Too many registration attempts. Please try again later.' };
      }

      const { username, email, password } = body as { username: string; email: string; password: string };

      // Check if user already exists
      const existingUser = await prisma.user.findFirst({
        where: {
          OR: [
            { username },
            { email }
          ]
        }
      });

      if (existingUser) {
        set.status = 409;
        return {
          success: false,
          message: existingUser.username === username ? 'Username already exists' : 'Email already exists'
        };
      }

      // Hash password
      const saltRounds = 12;
      const hashedPassword = await bcrypt.hash(password, saltRounds);

      // Create user
      const user = await prisma.user.create({
        data: {
          username,
          email,
          passwordHash: hashedPassword,
          role: 'user' // default role
        }
      });

      // Generate session token for auto-login after registration
      const token = randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

      // Create session
      await prisma.userSession.create({
        data: {
          userId: user.id,
          sessionToken: token,
          expiresAt
        }
      });

      // Set cookie
      sessionToken.set({
        value: token,
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 24 * 60 * 60 // 24 hours in seconds
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
          lastLoginAt: null
        }
      };
    } catch (error) {
      log.error({ err: error }, 'Registration error');
      set.status = 500;
      return { success: false, message: 'Internal server error during registration' };
    }
  }, {
    body: t.Object({
      username: t.String({ minLength: 3, maxLength: 50 }),
      email: t.String({ format: 'email' }),
      password: t.String({ minLength: 8 })
    })
  })

  .post('/login', async ({ body, set, cookie: { sessionToken }, request }) => {
    try {
      const clientIp = request.headers.get('x-forwarded-for') || 'unknown';
      if (!checkAuthRateLimit(`login:${clientIp}`)) {
        set.status = 429;
        return { success: false, message: 'Too many login attempts. Please try again later.' };
      }

      const { username, password } = body as { username: string; password: string };

      // Find user
      const user = await prisma.user.findFirst({
        where: {
          OR: [
            { username },
            { email: username } // Allow email login
          ]
        }
      });

      if (!user || !user.passwordHash) {
        set.status = 401;
        return { success: false, message: 'Invalid credentials' };
      }

      // Verify password
      const isValidPassword = await bcrypt.compare(password, user.passwordHash);
      if (!isValidPassword) {
        set.status = 401;
        return { success: false, message: 'Invalid credentials' };
      }

      // Generate session token
      const token = randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

      // Create session
      await prisma.userSession.create({
        data: {
          userId: user.id,
          sessionToken: token,
          expiresAt
        }
      });

      // Set cookie
      sessionToken.set({
        value: token,
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 24 * 60 * 60 // 24 hours in seconds
      });

      // Update last login
      await prisma.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() }
      });

      return {
        success: true,
        message: 'Login successful',
        token: token,
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          role: user.role,
          createdAt: user.createdAt.toISOString(),
          lastLoginAt: user.lastLoginAt?.toISOString() || null
        }
      };
    } catch (error) {
      log.error({ err: error }, 'Login error');
      set.status = 500;
      return { success: false, message: 'Internal server error during login' };
    }
  }, {
    body: t.Object({
      username: t.String(),
      password: t.String()
    })
  })

  .post('/logout', async ({ cookie: { sessionToken }, set }) => {
    try {
      const token = sessionToken.value;

      if (token) {
        // Invalidate session
        await prisma.userSession.deleteMany({
          where: { sessionToken: token }
        });

        // Clear cookie
        sessionToken.remove();
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
      const token = sessionToken.value;

      if (!token) {
        set.status = 401;
        return { success: false, message: 'No session token' };
      }

      // Find valid session
      const session = await prisma.userSession.findFirst({
        where: {
          sessionToken: token,
          expiresAt: {
            gt: new Date()
          }
        },
        include: {
          user: true
        }
      });

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
          lastLoginAt: session.user.lastLoginAt
        }
      };
    } catch (error) {
      log.error({ err: error }, 'Get user error');
      set.status = 500;
      return { success: false, message: 'Internal server error getting user info' };
    }
  })

  .get('/sessions', async ({ cookie: { sessionToken }, set }) => {
    try {
      const token = sessionToken.value;

      if (!token) {
        set.status = 401;
        return { success: false, message: 'No session token' };
      }

      // Find current user
      const currentSession = await prisma.userSession.findFirst({
        where: {
          sessionToken: token,
          expiresAt: { gt: new Date() }
        },
        include: { user: true }
      });

      if (!currentSession) {
        set.status = 401;
        return { success: false, message: 'Invalid session' };
      }

      // Get all sessions for this user
      const sessions = await prisma.userSession.findMany({
        where: {
          userId: currentSession.user.id,
          expiresAt: { gt: new Date() }
        },
        orderBy: { createdAt: 'desc' }
      });

      return {
        success: true,
        sessions: sessions.map(session => ({
          id: session.id,
          isCurrentSession: session.sessionToken === token,
          createdAt: session.createdAt,
          expiresAt: session.expiresAt
        }))
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

      // Find current user
      const currentSession = await prisma.userSession.findFirst({
        where: {
          sessionToken: token,
          expiresAt: { gt: new Date() }
        },
        include: { user: true }
      });

      if (!currentSession) {
        set.status = 401;
        return { success: false, message: 'Invalid session' };
      }

      // Delete the specified session (only if it belongs to current user)
      const sessionIdNum = parseInt(sessionId);
      if (isNaN(sessionIdNum)) {
        set.status = 400;
        return { success: false, message: 'Invalid session ID' };
      }

      const result = await prisma.userSession.deleteMany({
        where: {
          id: sessionIdNum,
          userId: currentSession.user.id
        }
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

      // Verify the caller is authenticated
      const currentSession = await prisma.userSession.findFirst({
        where: {
          sessionToken: token,
          expiresAt: { gt: new Date() }
        },
        include: { user: true }
      });

      if (!currentSession || currentSession.user.role !== 'admin') {
        set.status = 403;
        return { success: false, message: 'Admin access required' };
      }

      // Clean up expired sessions
      const result = await prisma.userSession.deleteMany({
        where: {
          expiresAt: {
            lt: new Date()
          }
        }
      });

      return {
        success: true,
        message: `Cleaned up ${result.count} expired sessions`
      };
    } catch (error) {
      log.error({ err: error }, 'Cleanup sessions error');
      set.status = 500;
      return { success: false, message: 'Internal server error during cleanup' };
    }
  })

  // Google OAuth endpoints
  .get('/google/url', async ({ set }) => {
    try {
      // Generate authorization URL
      const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: GOOGLE_SCOPES,
        prompt: 'select_account'
      });

      return {
        success: true,
        url: authUrl
      };
    } catch (error) {
      log.error({ err: error }, 'Google auth URL generation error');
      set.status = 500;
      return { success: false, message: 'Failed to generate Google authentication URL' };
    }
  })

  .get('/google', async ({ set }) => {
    try {
      // Generate authorization URL
      const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: GOOGLE_SCOPES,
        prompt: 'select_account'
      });

      // Redirect to Google
      set.status = 302;
      set.headers.location = authUrl;
      return;
    } catch (error) {
      log.error({ err: error }, 'Google auth initiation error');
      set.status = 500;
      return { success: false, message: 'Failed to initiate Google authentication' };
    }
  })

  .get('/google/callback', async ({ query, set, cookie: { sessionToken } }) => {
    try {
      const { code, error } = query;

      // Handle OAuth error
      if (error) {
        set.status = 400;
        set.headers.location = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/auth?error=oauth_failed`;
        return;
      }

      if (!code || typeof code !== 'string') {
        set.status = 400;
        set.headers.location = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/auth?error=missing_code`;
        return;
      }

      // Exchange code for tokens
      const { tokens } = await oauth2Client.getToken(code);
      oauth2Client.setCredentials(tokens);

      // Get user info from Google
      const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
      const userInfoResponse = await oauth2.userinfo.get();
      const googleUserInfo = userInfoResponse.data;

      if (!googleUserInfo.email) {
        set.status = 400;
        set.headers.location = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/auth?error=no_email`;
        return;
      }

      // Check if user exists by Google ID or email
      let user = await prisma.user.findFirst({
        where: {
          OR: [
            { googleId: googleUserInfo.id },
            { email: googleUserInfo.email }
          ]
        }
      });

      if (user) {
        // Update existing user with Google info if needed
        if (!user.googleId && googleUserInfo.id) {
          user = await prisma.user.update({
            where: { id: user.id },
            data: { googleId: googleUserInfo.id }
          });
        }
      } else {
        // Create new user
        user = await prisma.user.create({
          data: {
            username: googleUserInfo.name || googleUserInfo.email!.split('@')[0],
            email: googleUserInfo.email!,
            googleId: googleUserInfo.id,
            role: 'user',
            // No password hash for OAuth users
            passwordHash: null
          }
        });
      }

      // Generate session token
      const token = randomBytes(32).toString('hex');
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours

      // Create session
      await prisma.userSession.create({
        data: {
          userId: user.id,
          sessionToken: token,
          expiresAt
        }
      });

      // Set cookie
      sessionToken.set({
        value: token,
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 24 * 60 * 60 // 24 hours in seconds
      });

      // Update last login
      await prisma.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() }
      });

      // Redirect to frontend with success
      set.status = 302;
      set.headers.location = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/?auth_success=true`;
      return;

    } catch (error) {
      log.error({ err: error }, 'Google callback error');
      set.status = 302;
      set.headers.location = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/auth?error=callback_failed`;
      return;
    }
  });