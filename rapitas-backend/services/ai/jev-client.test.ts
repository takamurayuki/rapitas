/**
 * jev-client.test
 *
 * Locks the fail-open contract: no API key, a non-OK response, a timeout, or
 * a malformed body all resolve to null rather than throwing — every caller
 * of this module depends on that to stay a safe no-op when Jev is not
 * configured or having a bad day.
 */
import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test';

const noopLog = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
mock.module('../../config/logger', () => ({ createLogger: () => noopLog, logger: noopLog }));

const { askJevBoolean, isJevConfigured } = await import('./jev-client');

const realFetch = globalThis.fetch;
const realKey = process.env.RAPITAS_JEV_API_KEY;

afterEach(() => {
  globalThis.fetch = realFetch;
  if (realKey === undefined) delete process.env.RAPITAS_JEV_API_KEY;
  else process.env.RAPITAS_JEV_API_KEY = realKey;
});

describe('isJevConfigured / no API key', () => {
  beforeEach(() => {
    delete process.env.RAPITAS_JEV_API_KEY;
  });

  it('reports not configured when the env var is unset', () => {
    expect(isJevConfigured()).toBe(false);
  });

  it('askJevBoolean returns null without ever calling fetch', async () => {
    let called = false;
    // @ts-expect-error test stub
    globalThis.fetch = mock(async () => {
      called = true;
      return { ok: true, status: 200, json: async () => ({ answers: [] }) };
    });
    const result = await askJevBoolean('ctx', [{ id: 'q1', prompt: 'still relevant?' }]);
    expect(result).toBeNull();
    expect(called).toBe(false);
  });
});

describe('askJevBoolean — with a configured key', () => {
  beforeEach(() => {
    process.env.RAPITAS_JEV_API_KEY = 'test-key';
  });

  it('reports configured', () => {
    expect(isJevConfigured()).toBe(true);
  });

  it('returns an empty array without calling fetch when there are no questions', async () => {
    let called = false;
    // @ts-expect-error test stub
    globalThis.fetch = mock(async () => {
      called = true;
      return { ok: true, status: 200, json: async () => ({ answers: [] }) };
    });
    expect(await askJevBoolean('ctx', [])).toEqual([]);
    expect(called).toBe(false);
  });

  it('sends the model, context and typed questions, and parses valid answers', async () => {
    let capturedBody: string | undefined;
    let capturedAuth: string | undefined;
    // @ts-expect-error test stub
    globalThis.fetch = mock(
      async (_url: string, init: { body: string; headers: Record<string, string> }) => {
        capturedBody = init.body;
        capturedAuth = init.headers.Authorization;
        return {
          ok: true,
          status: 200,
          json: async () => ({ answers: [{ id: 'q1', probability: 0.87 }] }),
        };
      },
    );
    const result = await askJevBoolean('some context', [
      { id: 'q1', prompt: 'still a real problem?' },
    ]);
    expect(result).toEqual([{ id: 'q1', probability: 0.87 }]);
    expect(capturedAuth).toBe('Bearer test-key');
    const body = JSON.parse(capturedBody!);
    expect(body.model).toBe('jev-latest');
    expect(body.context).toBe('some context');
    expect(body.questions).toEqual([
      { id: 'q1', type: 'boolean', prompt: 'still a real problem?' },
    ]);
  });

  it('drops malformed answer entries but keeps valid ones', async () => {
    // @ts-expect-error test stub
    globalThis.fetch = mock(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        answers: [
          { id: 'q1', probability: 0.5 },
          { id: 'q2', probability: 'not-a-number' },
          { id: 123, probability: 0.9 },
          { id: 'q3', probability: 1.5 },
          { id: 'q4', probability: -0.1 },
        ],
      }),
    }));
    const result = await askJevBoolean('ctx', [{ id: 'q1', prompt: 'p' }]);
    expect(result).toEqual([{ id: 'q1', probability: 0.5 }]);
  });

  it('returns null on a non-OK response', async () => {
    // @ts-expect-error test stub
    globalThis.fetch = mock(async () => ({ ok: false, status: 500, json: async () => ({}) }));
    expect(await askJevBoolean('ctx', [{ id: 'q1', prompt: 'p' }])).toBeNull();
  });

  it('returns null when fetch throws (network error / timeout)', async () => {
    // @ts-expect-error test stub
    globalThis.fetch = mock(async () => {
      throw new Error('network down');
    });
    expect(await askJevBoolean('ctx', [{ id: 'q1', prompt: 'p' }])).toBeNull();
  });

  it('returns null when the response body has no answers array', async () => {
    // @ts-expect-error test stub
    globalThis.fetch = mock(async () => ({ ok: true, status: 200, json: async () => ({}) }));
    expect(await askJevBoolean('ctx', [{ id: 'q1', prompt: 'p' }])).toBeNull();
  });
});
