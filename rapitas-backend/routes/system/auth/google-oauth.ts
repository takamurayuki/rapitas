/**
 * Google OAuth Routes
 *
 * Handles Google OAuth 2.0 flow: authorization URL generation, redirect initiation,
 * and callback processing. Creates or links user accounts on successful auth.
 */
import { Elysia } from 'elysia';
import { google } from 'googleapis';
import { randomBytes } from 'crypto';
import { prisma } from '../../../config/database';
import { createLogger } from '../../../config/logger';

const log = createLogger('routes:auth:google');

// NOTE: oauth2Client is module-scoped so credentials set during callback persist for the request lifetime.
const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_CALLBACK_URL || 'http://localhost:3000/auth/google/callback',
);

const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
];

/**
 * Elysia route group for Google OAuth endpoints.
 * Mounted under /auth via the parent auth routes.
 */
export const googleOAuthRoutes = new Elysia()

  .get('/google/url', async ({ set }) => {
    try {
      const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: GOOGLE_SCOPES,
        prompt: 'select_account',
      });

      return { success: true, url: authUrl };
    } catch (error) {
      log.error({ err: error }, 'Google auth URL generation error');
      set.status = 500;
      return { success: false, message: 'Failed to generate Google authentication URL' };
    }
  })

  .get('/google', async ({ set }) => {
    try {
      const authUrl = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: GOOGLE_SCOPES,
        prompt: 'select_account',
      });

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

      const { tokens } = await oauth2Client.getToken(code);
      oauth2Client.setCredentials(tokens);

      const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
      const userInfoResponse = await oauth2.userinfo.get();
      const googleUserInfo = userInfoResponse.data;

      if (!googleUserInfo.email) {
        set.status = 400;
        set.headers.location = `${process.env.FRONTEND_URL || 'http://localhost:3000'}/auth?error=no_email`;
        return;
      }

      let user = await prisma.user.findFirst({
        where: {
          OR: [{ googleId: googleUserInfo.id }, { email: googleUserInfo.email }],
        },
      });

      if (user) {
        if (!user.googleId && googleUserInfo.id) {
          user = await prisma.user.update({
            where: { id: user.id },
            data: { googleId: googleUserInfo.id },
          });
        }
      } else {
        user = await prisma.user.create({
          data: {
            username: googleUserInfo.name || googleUserInfo.email!.split('@')[0],
            email: googleUserInfo.email!,
            googleId: googleUserInfo.id,
            role: 'user',
            // No password hash for OAuth users
            passwordHash: null,
          },
        });
      }

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
