/**
 * local-auth.security.test
 *
 * Locks down the CSRF backstop (createCrossSiteGuard) and the git-ref safety
 * assertion — the two guards added after the security audit found a
 * cross-site-write → git-injection chain reachable on the default loopback
 * deployment.
 */
import { describe, it, expect } from 'bun:test';
import { createCrossSiteGuard, isGuardedRequest } from './local-auth';
import { assertSafeGitRef } from '../utils/common/branch-name-generator';

const req = (method: string, site?: string, origin?: string, path = '/tasks/1/execute') => {
  const headers: Record<string, string> = {};
  if (site) headers['sec-fetch-site'] = site;
  if (origin) headers['origin'] = origin;
  return new Request(`http://127.0.0.1:3001${path}`, { method, headers });
};

describe('createCrossSiteGuard', () => {
  const guard = createCrossSiteGuard();

  it('blocks a cross-site POST (drive-by localhost CSRF)', () => {
    const res = guard({ request: req('POST', 'cross-site') });
    expect(res).toBeInstanceOf(Response);
    expect(res!.status).toBe(403);
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('blocks cross-site %s', (method) => {
    expect(guard({ request: req(method, 'cross-site') })).toBeInstanceOf(Response);
  });

  it('allows a cross-site write from an allow-listed loopback Origin (127.0.0.1 API target)', () => {
    // localhost:3000 page → 127.0.0.1:3001 API: cross-site by site algorithm,
    // but the Origin is browser-vouched and ours.
    expect(guard({ request: req('POST', 'cross-site', 'http://localhost:3000') })).toBeUndefined();
    expect(guard({ request: req('PATCH', 'cross-site', 'tauri://localhost') })).toBeUndefined();
  });

  it('still blocks a cross-site write from a foreign Origin (drive-by site)', () => {
    const res = guard({ request: req('POST', 'cross-site', 'https://evil.example') });
    expect(res).toBeInstanceOf(Response);
    expect(res!.status).toBe(403);
  });

  it('still blocks a cross-site write that carries no Origin at all', () => {
    expect(guard({ request: req('POST', 'cross-site') })).toBeInstanceOf(Response);
  });

  it('allows same-origin writes (the app itself)', () => {
    expect(guard({ request: req('POST', 'same-origin') })).toBeUndefined();
  });

  it('allows none (direct navigation)', () => {
    expect(guard({ request: req('POST', 'none') })).toBeUndefined();
  });

  // SameSite ignores the port, so a page on 127.0.0.1:5173 (a dev server the
  // in-app browser may open) is same-site with the API on 127.0.0.1:3001 and
  // carries its cookie. Same-site writes therefore need an allow-listed
  // Origin, exactly like cross-site ones (nav60 §5.4.2).
  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])(
    'blocks a same-site %s with no Origin or a foreign Origin',
    (method) => {
      for (const origin of [undefined, 'http://127.0.0.1:5173', 'null']) {
        const res = guard({ request: req(method, 'same-site', origin) });
        expect(res).toBeInstanceOf(Response);
        expect(res!.status).toBe(403);
      }
    },
  );

  it('allows a same-site write from an allow-listed Origin (the app on 127.0.0.1:3000)', () => {
    const prev = process.env.CORS_ORIGIN;
    delete process.env.CORS_ORIGIN;
    try {
      const defaultGuard = createCrossSiteGuard();
      for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
        expect(
          defaultGuard({ request: req(method, 'same-site', 'http://127.0.0.1:3000') }),
        ).toBeUndefined();
      }
    } finally {
      if (prev === undefined) delete process.env.CORS_ORIGIN;
      else process.env.CORS_ORIGIN = prev;
    }
  });

  it('allows requests with no Sec-Fetch-Site (Tauri IPC, curl, EventSource)', () => {
    expect(guard({ request: req('POST') })).toBeUndefined();
  });

  // nav60 §9 audit: these GETs change state, so they are guarded like writes.
  const STATE_CHANGING_GETS = [
    '/agents/diagnose',
    '/project-health/scan',
    '/workflow/tasks/12/analyze-complexity',
    '/workflow/learning/tasks/12/duration-prediction',
    '/tasks/suggestions/ai',
    '/github/pull-requests/by-task/12',
  ];

  it.each(STATE_CHANGING_GETS)('blocks a foreign-origin or origin-less GET %s', (path) => {
    for (const [site, origin] of [
      ['cross-site', undefined],
      ['cross-site', 'https://evil.example'],
      ['same-site', undefined],
      ['same-site', 'http://127.0.0.1:5173'],
    ] as const) {
      const res = guard({ request: req('GET', site, origin, path) });
      expect(res?.status).toBe(403);
    }
  });

  it.each(STATE_CHANGING_GETS)('still serves the app (allow-listed Origin) for %s', (path) => {
    const prev = process.env.CORS_ORIGIN;
    delete process.env.CORS_ORIGIN;
    try {
      const g = createCrossSiteGuard();
      expect(
        g({ request: req('GET', 'same-site', 'http://127.0.0.1:3000', path) }),
      ).toBeUndefined();
      expect(g({ request: req('GET', 'same-origin', undefined, path) })).toBeUndefined();
      expect(g({ request: req('GET', undefined, undefined, path) })).toBeUndefined();
    } finally {
      if (prev === undefined) delete process.env.CORS_ORIGIN;
      else process.env.CORS_ORIGIN = prev;
    }
  });

  it('does not guard look-alike read routes', () => {
    for (const path of [
      '/github/pull-requests/by-task/12/ci-status',
      '/project-health',
      '/tasks/suggestions',
      '/agents/diagnose-report',
    ]) {
      expect(isGuardedRequest(req('GET', 'cross-site', undefined, path))).toBe(false);
    }
  });

  it('never blocks other GET/HEAD even cross-site (reads)', () => {
    expect(guard({ request: req('GET', 'cross-site') })).toBeUndefined();
    expect(guard({ request: req('HEAD', 'cross-site') })).toBeUndefined();
  });

  // Origin fallback: defense in depth for clients that send Origin but omit
  // Sec-Fetch-Site entirely (see NOTE(security) in local-auth.ts). Uses its
  // own guard instance with CORS_ORIGIN explicitly cleared so the expected
  // allow-list (the hardcoded default) doesn't depend on this machine's .env.
  it('blocks a disallowed Origin when Sec-Fetch-Site is absent', () => {
    const prev = process.env.CORS_ORIGIN;
    delete process.env.CORS_ORIGIN;
    try {
      const defaultGuard = createCrossSiteGuard();
      const res = defaultGuard({ request: req('POST', undefined, 'https://evil.example.com') });
      expect(res).toBeInstanceOf(Response);
      expect(res!.status).toBe(403);
    } finally {
      if (prev !== undefined) process.env.CORS_ORIGIN = prev;
    }
  });

  it('allows an allow-listed Origin when Sec-Fetch-Site is absent', () => {
    const prev = process.env.CORS_ORIGIN;
    delete process.env.CORS_ORIGIN;
    try {
      const defaultGuard = createCrossSiteGuard();
      expect(
        defaultGuard({ request: req('POST', undefined, 'http://localhost:3000') }),
      ).toBeUndefined();
      expect(
        defaultGuard({ request: req('POST', undefined, 'http://127.0.0.1:3000') }),
      ).toBeUndefined();
      expect(
        defaultGuard({ request: req('POST', undefined, 'tauri://localhost') }),
      ).toBeUndefined();
    } finally {
      if (prev !== undefined) process.env.CORS_ORIGIN = prev;
    }
  });

  it('allows requests with no Origin and no Sec-Fetch-Site (Tauri IPC, curl)', () => {
    expect(guard({ request: req('POST') })).toBeUndefined();
  });
});

describe('assertSafeGitRef', () => {
  it('accepts normal branch names', () => {
    for (const ok of ['develop', 'main', 'feature/foo-bar', 'bugfix/123-x', 'release/1.2.3']) {
      expect(() => assertSafeGitRef(ok)).not.toThrow();
    }
  });

  it.each(['x"&calc.exe&"', 'x; rm -rf /', 'x`whoami`', 'x$(id)', 'x|nc', 'a b', 'x&&y', "x'y"])(
    'rejects the shell-metacharacter payload %p',
    (bad) => {
      expect(() => assertSafeGitRef(bad)).toThrow();
    },
  );

  it.each(['../../etc/passwd', '-D', 'a..b'])(
    'rejects path traversal / leading dash: %p',
    (bad) => {
      expect(() => assertSafeGitRef(bad)).toThrow();
    },
  );

  it.each(['', 'a'.repeat(201)])('rejects empty and over-long refs: %p', (bad) => {
    expect(() => assertSafeGitRef(bad)).toThrow();
  });
});
