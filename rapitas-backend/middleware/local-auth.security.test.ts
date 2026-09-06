/**
 * local-auth.security.test
 *
 * Locks down the CSRF backstop (createCrossSiteGuard) and the git-ref safety
 * assertion — the two guards added after the security audit found a
 * cross-site-write → git-injection chain reachable on the default loopback
 * deployment.
 */
import { describe, it, expect } from 'bun:test';
import { createCrossSiteGuard } from './local-auth';
import { assertSafeGitRef } from '../utils/common/branch-name-generator';

const req = (method: string, site?: string, origin?: string) => {
  const headers: Record<string, string> = {};
  if (site) headers['sec-fetch-site'] = site;
  if (origin) headers['origin'] = origin;
  return new Request('http://127.0.0.1:3001/tasks/1/execute', { method, headers });
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

  it('allows same-site and none (direct navigation)', () => {
    expect(guard({ request: req('POST', 'same-site') })).toBeUndefined();
    expect(guard({ request: req('POST', 'none') })).toBeUndefined();
  });

  it('allows requests with no Sec-Fetch-Site (Tauri IPC, curl, EventSource)', () => {
    expect(guard({ request: req('POST') })).toBeUndefined();
  });

  it('never blocks GET/HEAD even cross-site (reads)', () => {
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
