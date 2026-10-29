/**
 * Google OAuth Routes
 *
 * Handles Google OAuth 2.0 flow: authorization URL generation, redirect initiation,
 * and callback processing. Creates or links user accounts on successful auth,
 * and gives every account a workspace before it can be signed in.
 */
import { Elysia } from 'elysia';
import { google } from 'googleapis';
import { randomBytes } from 'crypto';
import { prisma } from '../../../config/database';
import { createLogger } from '../../../config/logger';
import { ensureWorkspaceForUser } from '../../../services/tenancy/workspace-provisioning';
import { frontendUrl } from '../../../config/frontend-url';

const log = createLogger('routes:auth:google');

/**
 * Where Google sends the browser back to.
 *
 * This backend, not the frontend: the callback handler below is what exchanges
 * the code and sets the session cookie. The frontend has no such route, so a
 * default pointing at port 3000 lands the user on a 404 with no session.
 */
const DEFAULT_CALLBACK_URL = 'http://127.0.0.1:3001/auth/google/callback';

const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
];

/**
 * Whether this install has Google client credentials at all.
 *
 * Without them `generateAuthUrl` still produces a URL — one carrying
 * `client_id=` — and Google answers it with its generic "access blocked"
 * page naming no cause. Refusing here tells the caller what is actually
 * wrong.
 *
 * @returns True when both the id and the secret are set / 両方設定済みならtrue
 */
export function isGoogleOAuthConfigured(): boolean {
  return (
    (process.env.GOOGLE_CLIENT_ID ?? '').trim() !== '' &&
    (process.env.GOOGLE_CLIENT_SECRET ?? '').trim() !== ''
  );
}

/**
 * A client for one request.
 *
 * NOTE: deliberately not module-scoped. The callback calls setCredentials on
 * it, so a shared instance lets one sign-in's tokens decide whose profile the
 * next concurrent `userinfo.get()` returns.
 *
 * @returns A fresh OAuth2 client / 新しいOAuth2クライアント
 */
function createOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_CALLBACK_URL || DEFAULT_CALLBACK_URL,
  );
}

/** The frontend origin to hand the browser back to once the cookie is set. */

/**
 * Elysia route group for Google OAuth endpoints.
 * Mounted under /auth via the parent auth routes.
 */
export const googleOAuthRoutes = new Elysia()

  .get('/google/url', async ({ set }) => {
    if (!isGoogleOAuthConfigured()) {
      set.status = 503;
      return {
        success: false,
        message:
          'Googleログインは未設定です。GOOGLE_CLIENT_ID と GOOGLE_CLIENT_SECRET を設定してください。',
      };
    }
    try {
      const authUrl = createOAuthClient().generateAuthUrl({
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
    if (!isGoogleOAuthConfigured()) {
      set.status = 503;
      return {
        success: false,
        message:
          'Googleログインは未設定です。GOOGLE_CLIENT_ID と GOOGLE_CLIENT_SECRET を設定してください。',
      };
    }
    try {
      const authUrl = createOAuthClient().generateAuthUrl({
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
        set.headers.location = `${frontendUrl()}/auth?error=oauth_failed`;
        return;
      }

      if (!code || typeof code !== 'string') {
        set.status = 400;
        set.headers.location = `${frontendUrl()}/auth?error=missing_code`;
        return;
      }

      const oauth2Client = createOAuthClient();
      const { tokens } = await oauth2Client.getToken(code);
      oauth2Client.setCredentials(tokens);

      const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
      const userInfoResponse = await oauth2.userinfo.get();
      const googleUserInfo = userInfoResponse.data;

      if (!googleUserInfo.email) {
        set.status = 400;
        set.headers.location = `${frontendUrl()}/auth?error=no_email`;
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

      // Before the session exists, exactly as register and login do it. An
      // account signed in without a workspace resolves to "no workspace",
      // which workspace-scope passes through unchanged — so it would read
      // every workspace's rows. A failure here throws to the catch below and
      // issues no session: a failed sign-in beats a boundaryless one.
      const workspace = await ensureWorkspaceForUser(user.id, user.username);
      log.info(
        { userId: user.id, workspace: workspace.slug },
        '[google-callback] account signed in with its workspace',
      );

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
      set.headers.location = `${frontendUrl()}/?auth_success=true`;
      return;
    } catch (error) {
      log.error({ err: error }, 'Google callback error');
      set.status = 302;
      set.headers.location = `${frontendUrl()}/auth?error=callback_failed`;
      return;
    }
  });
