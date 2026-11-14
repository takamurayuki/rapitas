/**
 * embed-check-service.test
 *
 * The fetch side of /url-embed-check: what is fetched (first URL and each
 * redirect re-checked against private addresses, at most 3 redirects, GET
 * with only a User-Agent, bodies cancelled unread), the 5-second deadline,
 * the cache key, and that the route answers only `{ result }`.
 *
 * DNS is injected (as in url-fetch-guard.test.ts) and fetch is a stub, so
 * nothing leaves the machine.
 */
import { describe, expect, test } from 'bun:test';
import { Elysia } from 'elysia';
import { checkEmbeddable, EmbedVerdictCache } from './embed-check-service';
import { createEmbedCheckRoutes } from './embed-check.routes';

const APP = 'http://localhost:3000';

/** Public names resolve to a documentation address; `internal.test` to loopback. */
const resolver = async (host: string) =>
  host.startsWith('internal') ? ['127.0.0.1'] : ['93.184.216.34'];

interface Call {
  url: string;
  init: RequestInit;
  cancelled: boolean;
}

/** A fetch stub answering from a route table, recording every call. */
function stubFetch(routes: Record<string, { status?: number; headers?: Record<string, string> }>) {
  const calls: Call[] = [];
  const impl = (async (input: string | URL, init: RequestInit = {}) => {
    const url = input.toString();
    const route = routes[url];
    if (!route) throw new Error(`unexpected fetch ${url}`);
    const call: Call = { url, init, cancelled: false };
    calls.push(call);
    const body = new ReadableStream({
      cancel() {
        call.cancelled = true;
      },
    });
    const res = new Response(body, { status: route.status ?? 200, headers: route.headers });
    Object.defineProperty(res, 'url', { value: url });
    return res;
  }) as typeof fetch;
  return { impl, calls };
}

const fresh = () => new EmbedVerdictCache();

describe('checkEmbeddable', () => {
  test('reads the final response headers after a redirect', async () => {
    const { impl, calls } = stubFetch({
      'https://a.example/': { status: 302, headers: { location: 'https://b.example/final' } },
      'https://b.example/final': { headers: { 'x-frame-options': 'DENY' } },
    });
    const v = await checkEmbeddable(
      'https://a.example/',
      APP,
      { resolver, fetchImpl: impl },
      fresh(),
    );
    expect(v).toBe('refused');
    expect(calls.map((c) => c.url)).toEqual(['https://a.example/', 'https://b.example/final']);
  });

  test('sends GET with only a User-Agent, manual redirects, and cancels every body', async () => {
    const { impl, calls } = stubFetch({
      'https://a.example/': { status: 301, headers: { location: '/next' } },
      'https://a.example/next': {},
    });
    await checkEmbeddable('https://a.example/', APP, { resolver, fetchImpl: impl }, fresh());
    for (const call of calls) {
      expect(call.init.method ?? 'GET').toBe('GET');
      expect(call.init.redirect).toBe('manual');
      expect(Object.keys(call.init.headers as Record<string, string>)).toEqual(['User-Agent']);
      expect(call.init.credentials).toBeUndefined();
    }
    await Bun.sleep(0);
    expect(calls.every((c) => c.cancelled)).toBe(true);
  });

  test('never fetches a first URL that resolves internally', async () => {
    const { impl, calls } = stubFetch({});
    for (const url of ['http://localhost:3001/', 'http://127.0.0.1/', 'https://internal.test/']) {
      expect(await checkEmbeddable(url, APP, { resolver, fetchImpl: impl }, fresh())).toBe(
        'unknown',
      );
    }
    expect(calls).toHaveLength(0);
  });

  test.each([1, 2, 3])('stops at an internal Location on redirect hop %i', async (hop) => {
    const routes: Record<string, { status?: number; headers?: Record<string, string> }> = {};
    for (let i = 0; i < hop - 1; i += 1) {
      routes[`https://h${i}.example/`] = {
        status: 302,
        headers: { location: `https://h${i + 1}.example/` },
      };
    }
    routes[`https://h${hop - 1}.example/`] = {
      status: 302,
      headers: { location: 'http://internal.test/secret' },
    };
    const { impl, calls } = stubFetch(routes);
    const v = await checkEmbeddable(
      'https://h0.example/',
      APP,
      { resolver, fetchImpl: impl },
      fresh(),
    );
    expect(v).toBe('unknown');
    expect(calls.some((c) => c.url.includes('internal.test'))).toBe(false);
    expect(calls).toHaveLength(hop);
  });

  test('does not follow a fourth redirect (at most 4 GETs)', async () => {
    const routes: Record<string, { status?: number; headers?: Record<string, string> }> = {};
    for (let i = 0; i < 5; i += 1) {
      routes[`https://r${i}.example/`] = {
        status: 302,
        headers: { location: `https://r${i + 1}.example/` },
      };
    }
    const { impl, calls } = stubFetch(routes);
    const v = await checkEmbeddable(
      'https://r0.example/',
      APP,
      { resolver, fetchImpl: impl },
      fresh(),
    );
    expect(v).toBe('unknown');
    expect(calls).toHaveLength(4);
  });

  test('a response slower than the deadline is unknown', async () => {
    const never = (async (_: string | URL, init: RequestInit = {}) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      })) as typeof fetch;
    const started = Date.now();
    const v = await checkEmbeddable(
      'https://slow.example/',
      APP,
      { resolver, fetchImpl: never, timeoutMs: 50 },
      fresh(),
    );
    expect(v).toBe('unknown');
    expect(Date.now() - started).toBeLessThan(2000);
  });

  test('a network error is unknown', async () => {
    const failing = (async () => {
      throw new Error('ECONNRESET');
    }) as unknown as typeof fetch;
    expect(
      await checkEmbeddable('https://x.example/', APP, { resolver, fetchImpl: failing }, fresh()),
    ).toBe('unknown');
  });
});

describe('EmbedVerdictCache', () => {
  test('keys on the whole URL, so two pages of one site are not confused', async () => {
    const cache = fresh();
    const { impl, calls } = stubFetch({
      'https://site.example/open': {},
      'https://site.example/locked': { headers: { 'x-frame-options': 'DENY' } },
    });
    const deps = { resolver, fetchImpl: impl };
    expect(await checkEmbeddable('https://site.example/open', APP, deps, cache)).toBe('embeddable');
    expect(await checkEmbeddable('https://site.example/locked', APP, deps, cache)).toBe('refused');
    // Cached: a second ask (fragment ignored) does not fetch again.
    expect(await checkEmbeddable('https://site.example/open#x', APP, deps, cache)).toBe(
      'embeddable',
    );
    expect(calls).toHaveLength(2);
  });

  test('keys on the embedder too', () => {
    const u = new URL('https://site.example/');
    expect(EmbedVerdictCache.keyOf(u, 'http://localhost:3000')).not.toBe(
      EmbedVerdictCache.keyOf(u, 'http://127.0.0.1:3000'),
    );
  });

  test('expires after the TTL and keeps at most maxEntries, dropping the oldest', () => {
    const cache = new EmbedVerdictCache(1000, 2);
    cache.set('a', 'refused', 0);
    expect(cache.get('a', 999)).toBe('refused');
    expect(cache.get('a', 1000)).toBeNull();
    cache.set('a', 'refused', 0);
    cache.set('b', 'refused', 0);
    cache.set('c', 'refused', 0);
    expect(cache.size).toBe(2);
    expect(cache.get('a', 1)).toBeNull();
    expect(cache.get('c', 1)).toBe('refused');
  });
});

describe('POST /url-embed-check', () => {
  const app = (impl: typeof fetch) =>
    new Elysia().use(createEmbedCheckRoutes({ resolver, fetchImpl: impl }));
  const post = (a: Elysia, body: unknown) =>
    a.handle(
      new Request('http://127.0.0.1:3001/url-embed-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );

  test('returns only the three-valued result', async () => {
    const { impl } = stubFetch({
      'https://gh.example/': {
        headers: { 'x-frame-options': 'DENY', 'content-security-policy': 'secret-value' },
      },
    });
    const prev = process.env.CORS_ORIGIN;
    delete process.env.CORS_ORIGIN;
    try {
      const res = await post(app(impl), { url: 'https://gh.example/', origin: APP });
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json).toEqual({ result: 'refused' });
    } finally {
      if (prev === undefined) delete process.env.CORS_ORIGIN;
      else process.env.CORS_ORIGIN = prev;
    }
  });

  test('an embedder outside the allow-list is answered unknown without fetching', async () => {
    const { impl, calls } = stubFetch({});
    const res = await post(app(impl), {
      url: 'https://gh.example/',
      origin: 'https://evil.example',
    });
    expect(await res.json()).toEqual({ result: 'unknown' });
    expect(calls).toHaveLength(0);
  });
});
