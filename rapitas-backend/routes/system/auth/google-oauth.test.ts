/**
 * google-oauth route tests
 *
 * Three things this flow got wrong, each invisible until someone actually
 * clicked "Sign in with Google":
 *
 *  1. With no GOOGLE_CLIENT_ID the route still handed out an authorization URL
 *     carrying `client_id=`. Google cannot identify the app from that, so it
 *     answers with its generic "Access blocked: authorization error" page and
 *     `flowName=GeneralOAuthFlow` and no reason — measured against the running
 *     server 2026-10-28.
 *  2. The default callback pointed at the FRONTEND, which has no such route.
 *     The handler is here, on the backend.
 *  3. The callback created the user with prisma.user.create directly and never
 *     provisioned a workspace, unlike register and login. A signed-in account
 *     with no workspace resolves to "no workspace", which workspace-scope
 *     passes through unchanged — so that account sees EVERY workspace's data.
 *
 * NOT responsible for the token exchange itself (googleapis is mocked).
 */
import { describe, test, expect, mock, beforeEach, afterEach } from 'bun:test';
import { Elysia } from 'elysia';

/** Order matters for provisioning-before-session, so every call is recorded. */
let calls: string[] = [];

let googleProfile: { id?: string; email?: string; name?: string } = {};
let lastAuthUrlArgs: Record<string, unknown> | null = null;
let lastClientArgs: unknown[] = [];

const mockPrisma = {
  user: {
    findFirst: mock(() => {
      calls.push('user.findFirst');
      return Promise.resolve(null as unknown);
    }),
    create: mock(() => {
      calls.push('user.create');
      return Promise.resolve({ id: 7, username: 'yuki' });
    }),
    update: mock(() => {
      calls.push('user.update');
      return Promise.resolve({ id: 7, username: 'yuki' });
    }),
  },
  userSession: {
    create: mock(() => {
      calls.push('userSession.create');
      return Promise.resolve({});
    }),
  },
};

const mockEnsureWorkspace = mock(() => {
  calls.push('ensureWorkspaceForUser');
  return Promise.resolve({ id: 1, slug: 'yuki', name: 'yuki' });
});

mock.module('../../../config/database', () => ({
  ensureDatabaseConnection: () => Promise.resolve(),
  prisma: mockPrisma,
}));
mock.module('../../../services/tenancy/workspace-provisioning', () => ({
  ensureWorkspaceForUser: mockEnsureWorkspace,
}));
mock.module('../../../config/logger', () => ({
  createLogger: () => ({
    info: () => {},
    error: () => {},
    warn: () => {},
    debug: () => {},
  }),
}));
mock.module('googleapis', () => ({
  google: {
    auth: {
      OAuth2: class MockOAuth2 {
        constructor(...args: unknown[]) {
          lastClientArgs = args;
        }
        generateAuthUrl(args: Record<string, unknown>) {
          lastAuthUrlArgs = args;
          return 'https://accounts.google.com/o/oauth2/v2/auth?client_id=test';
        }
        getToken() {
          return Promise.resolve({ tokens: { access_token: 't' } });
        }
        setCredentials() {}
      },
    },
    oauth2: () => ({ userinfo: { get: () => Promise.resolve({ data: googleProfile }) } }),
  },
}));

const { googleOAuthRoutes } = await import('./google-oauth');

const ORIGINAL_ENV = {
  id: process.env.GOOGLE_CLIENT_ID,
  secret: process.env.GOOGLE_CLIENT_SECRET,
  callback: process.env.GOOGLE_CALLBACK_URL,
};

function configure(on: boolean): void {
  if (on) {
    process.env.GOOGLE_CLIENT_ID = 'test-client-id.apps.googleusercontent.com';
    process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
  } else {
    // Empty, not deleted: this is exactly what the live .env held.
    process.env.GOOGLE_CLIENT_ID = '';
    process.env.GOOGLE_CLIENT_SECRET = '';
  }
}

function app() {
  return new Elysia().use(googleOAuthRoutes);
}

beforeEach(() => {
  calls = [];
  googleProfile = { id: 'g-1', email: 'yuki@example.com', name: 'yuki' };
  lastAuthUrlArgs = null;
  lastClientArgs = [];
  for (const model of Object.values(mockPrisma)) {
    for (const method of Object.values(model)) method.mockClear();
  }
  mockEnsureWorkspace.mockClear();
  // mockImplementation, not mockResolvedValue: the latter REPLACES the body
  // and the call would stop being recorded, leaving the ordering assertion
  // below comparing two -1s and passing for the wrong reason.
  mockEnsureWorkspace.mockImplementation(() => {
    calls.push('ensureWorkspaceForUser');
    return Promise.resolve({ id: 1, slug: 'yuki', name: 'yuki' });
  });
  delete process.env.GOOGLE_CALLBACK_URL;
  configure(true);
});

afterEach(() => {
  if (ORIGINAL_ENV.id === undefined) delete process.env.GOOGLE_CLIENT_ID;
  else process.env.GOOGLE_CLIENT_ID = ORIGINAL_ENV.id;
  if (ORIGINAL_ENV.secret === undefined) delete process.env.GOOGLE_CLIENT_SECRET;
  else process.env.GOOGLE_CLIENT_SECRET = ORIGINAL_ENV.secret;
  if (ORIGINAL_ENV.callback === undefined) delete process.env.GOOGLE_CALLBACK_URL;
  else process.env.GOOGLE_CALLBACK_URL = ORIGINAL_ENV.callback;
});

describe('when Google sign-in is not configured', () => {
  test('GET /google/url refuses instead of handing out a URL with no client_id', async () => {
    configure(false);

    const res = await app().handle(new Request('http://localhost/google/url'));
    const body = (await res.json()) as { success: boolean; message?: string };

    expect(res.status).toBe(503);
    expect(body.success).toBe(false);
    // The point: the caller learns the install is unconfigured here, rather
    // than the user meeting Google's blocked-access page.
    expect(body.message).toContain('Google');
  });

  test('GET /google does not send the browser to Google', async () => {
    configure(false);

    const res = await app().handle(new Request('http://localhost/google'));

    expect(res.status).not.toBe(302);
    expect(res.headers.get('location')).toBeNull();
  });
});

describe('when it is configured', () => {
  test('GET /google/url returns an authorization URL', async () => {
    const res = await app().handle(new Request('http://localhost/google/url'));
    const body = (await res.json()) as { success: boolean; url?: string };

    expect(body.success).toBe(true);
    expect(body.url).toContain('accounts.google.com');
    expect(lastAuthUrlArgs).toMatchObject({ prompt: 'select_account' });
  });

  test('the redirect_uri defaults to this backend, not the frontend', async () => {
    // The frontend has no /auth/google/callback route — only /auth/login and
    // /auth/register — so a default pointing at :3000 lands on a 404 with no
    // session cookie ever set.
    await app().handle(new Request('http://localhost/google/url'));

    expect(lastClientArgs[2]).toBe('http://127.0.0.1:3001/auth/google/callback');
  });

  test('an explicit GOOGLE_CALLBACK_URL still wins', async () => {
    process.env.GOOGLE_CALLBACK_URL = 'https://example.test/cb';

    await app().handle(new Request('http://localhost/google/url'));

    expect(lastClientArgs[2]).toBe('https://example.test/cb');
  });
});

describe('the callback', () => {
  const callback = () => app().handle(new Request('http://localhost/google/callback?code=abc'));

  test('provisions a workspace for a brand-new account', async () => {
    mockPrisma.user.findFirst.mockResolvedValue(null);

    await callback();

    expect(mockEnsureWorkspace).toHaveBeenCalledWith(7, 'yuki');
  });

  test('creates the workspace before the session row exists', async () => {
    // Order is the whole guarantee: a session that exists before the
    // workspace can be used in that window, and in it the account resolves
    // to "no workspace" and reads every workspace's rows.
    mockPrisma.user.findFirst.mockResolvedValue(null);

    await callback();

    expect(calls.indexOf('ensureWorkspaceForUser')).toBeGreaterThan(-1);
    expect(calls.indexOf('ensureWorkspaceForUser')).toBeLessThan(
      calls.indexOf('userSession.create'),
    );
  });

  test('gives an existing account one when it is linked to Google', async () => {
    // Accounts that predate this flow have no workspace either, and linking
    // a googleId is not what gives them one.
    mockPrisma.user.findFirst.mockResolvedValue({ id: 42, username: 'taro', googleId: null });
    // Linking reassigns `user` from the update's result, so that is where the
    // id and name provisioning sees come from.
    mockPrisma.user.update.mockResolvedValue({ id: 42, username: 'taro', googleId: 'g-1' });

    await callback();

    expect(mockEnsureWorkspace).toHaveBeenCalledWith(42, 'taro');
    expect(mockPrisma.user.create).not.toHaveBeenCalled();
  });

  test('issues no session when provisioning fails', async () => {
    // Fail closed. A signed-in account with no workspace is the one outcome
    // worse than a failed sign-in.
    mockPrisma.user.findFirst.mockResolvedValue(null);
    mockEnsureWorkspace.mockRejectedValue(new Error('db down'));

    const res = await callback();

    expect(mockPrisma.userSession.create).not.toHaveBeenCalled();
    expect(res.headers.get('location')).toContain('error=');
  });

  test('refuses when Google returns no email', async () => {
    googleProfile = { id: 'g-1', name: 'yuki' };

    await callback();

    expect(mockPrisma.user.create).not.toHaveBeenCalled();
    expect(mockPrisma.userSession.create).not.toHaveBeenCalled();
  });
});
