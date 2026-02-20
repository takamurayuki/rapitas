import { Elysia, t } from 'elysia';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { google } from 'googleapis';

const prisma = new PrismaClient();

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
  .post('/register', async ({ body, set, cookie: { sessionToken } }) => {
    try {
      const { username, email, password } = body;

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
      console.error('Registration error:', error);
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

  .post('/login', async ({ body, set, cookie: { sessionToken } }) => {
    try {
      const { username, password } = body;

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
      console.error('Login error:', error);
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
      console.error('Logout error:', error);
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
      console.error('Get user error:', error);
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
      console.error('Get sessions error:', error);
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
      const result = await prisma.userSession.deleteMany({
        where: {
          id: sessionId,
          userId: currentSession.user.id
        }
      });

      if (result.count === 0) {
        set.status = 404;
        return { success: false, message: 'Session not found' };
      }

      return { success: true, message: 'Session deleted successfully' };
    } catch (error) {
      console.error('Delete session error:', error);
      set.status = 500;
      return { success: false, message: 'Internal server error deleting session' };
    }
  })

  .get('/cleanup-sessions', async ({ set }) => {
    try {
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
      console.error('Cleanup sessions error:', error);
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
      console.error('Google auth URL generation error:', error);
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
      console.error('Google auth initiation error:', error);
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
      console.error('Google callback error:', error);
      set.status = 302;
      set.headers.location = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/auth?error=callback_failed`;
      return;
    }
  });