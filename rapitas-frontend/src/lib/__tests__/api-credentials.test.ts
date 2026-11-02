/**
 * api-credentials.test.ts
 *
 * The defect this exists for: a freshly registered account still saw every
 * task. Its session cookie was never sent, because API requests are
 * cross-origin (page :3000, API :3001) and `fetch` omits cookies cross-origin
 * unless asked. With no cookie the backend established no workspace and served
 * the request unscoped.
 *
 * So the assertions that matter are: our own API gets credentials, somebody
 * else's host never does, and an explicit choice by the caller is respected.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@/utils/api', () => ({ API_BASE_URL: 'http://127.0.0.1:3001' }));

import {
  shouldAttachCredentials,
  installApiCredentials,
  resetApiCredentialsForTests,
} from '../api-credentials';

const ORIGIN = 'http://127.0.0.1:3000';
const API = 'http://127.0.0.1:3001';

describe('shouldAttachCredentials', () => {
  it.each([
    ['an absolute API url', `${API}/tasks`, true],
    ['an API url with a query', `${API}/tasks?status=todo`, true],
    ['the API root', API, true],
    ['a third-party host', 'https://api.github.com/repos', false],
    ['the page itself', `${ORIGIN}/_next/static/chunk.js`, false],
    // Same host, different port — the case that makes this necessary at all.
    ['another local port', 'http://127.0.0.1:9999/x', false],
  ])('%s -> %s', (_label, url, expected) => {
    expect(shouldAttachCredentials(url, undefined, ORIGIN, API)).toBe(expected);
  });

  it('treats a relative url as the page origin, not the API', () => {
    expect(shouldAttachCredentials('/tasks', undefined, ORIGIN, API)).toBe(false);
  });

  it('accepts a URL object and a Request', () => {
    expect(shouldAttachCredentials(new URL(`${API}/tasks`), undefined, ORIGIN, API)).toBe(true);
    expect(
      shouldAttachCredentials({ url: `${API}/tasks` } as Request, undefined, ORIGIN, API),
    ).toBe(true);
  });

  it.each([['include'], ['omit'], ['same-origin']] as const)(
    'leaves a caller that already chose %s alone',
    (mode) => {
      // Including 'omit': a caller that deliberately strips cookies must keep
      // that, or this wrapper becomes a way to leak them.
      expect(shouldAttachCredentials(`${API}/tasks`, { credentials: mode }, ORIGIN, API)).toBe(
        false,
      );
    },
  );

  it('does not throw on an unparseable input', () => {
    expect(shouldAttachCredentials('http://', undefined, ORIGIN, API)).toBe(false);
    expect(shouldAttachCredentials(123 as unknown as string, undefined, ORIGIN, API)).toBe(false);
  });
});

describe('installApiCredentials', () => {
  let original: typeof window.fetch;
  let calls: { url: unknown; init: RequestInit | undefined }[];

  beforeEach(() => {
    resetApiCredentialsForTests();
    calls = [];
    original = window.fetch;
    window.fetch = vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url, init });
      return Promise.resolve(new Response('{}'));
    }) as unknown as typeof window.fetch;
  });

  afterEach(() => {
    window.fetch = original;
    resetApiCredentialsForTests();
  });

  it('adds credentials to an API request made with a bare fetch', async () => {
    installApiCredentials();
    await fetch(`${API}/tasks`);
    expect(calls[0].init?.credentials).toBe('include');
  });

  it('leaves a third-party request untouched', async () => {
    installApiCredentials();
    await fetch('https://example.test/thing');
    expect(calls[0].init?.credentials).toBeUndefined();
  });

  it('keeps the caller’s method and headers', async () => {
    installApiCredentials();
    await fetch(`${API}/tasks`, { method: 'POST', headers: { 'X-A': '1' } });
    expect(calls[0].init).toMatchObject({ method: 'POST', headers: { 'X-A': '1' } });
    expect(calls[0].init?.credentials).toBe('include');
  });

  it('does not nest wrappers when called twice', async () => {
    // A remount must not wrap the wrapper: each layer would copy init again,
    // and the chain grows for the life of the page.
    installApiCredentials();
    const afterFirst = window.fetch;
    installApiCredentials();
    expect(window.fetch).toBe(afterFirst);
  });
});
