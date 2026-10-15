/**
 * Canary routes tests — hit endpoint side effects, rate limit, promotion validation.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createCanaryRoutes } from './canary.routes';
import { findToken, loadLedger } from '../../services/security/canary-ledger';

let dir: string;
// Requests built with app.handle() carry no socket, so the resolver is injected.
let resolvedIp: string | null = '127.0.0.1';
const canaryRoutes = createCanaryRoutes({
  notify: async () => undefined,
  resolveIp: () => resolvedIp,
});
const prev = process.env.RAPITAS_DATA_DIR;

beforeEach(() => {
  resolvedIp = '127.0.0.1';
  dir = mkdtempSync(join(tmpdir(), 'canary-route-'));
  process.env.RAPITAS_DATA_DIR = dir;
});
afterEach(() => {
  if (prev === undefined) delete process.env.RAPITAS_DATA_DIR;
  else process.env.RAPITAS_DATA_DIR = prev;
  rmSync(dir, { recursive: true, force: true });
});

const post = (path: string, body: unknown) =>
  canaryRoutes.handle(
    new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
  );

function logLines(): string[] {
  const logs = join(dir, 'logs');
  if (!existsSync(logs)) return [];
  return readdirSync(logs)
    .filter((n) => n.startsWith('canary-'))
    .flatMap((n) => readFileSync(join(logs, n), 'utf8').trim().split('\n'));
}

describe('canary routes', () => {
  test('issuing then hitting logs one line with the UA; unknown id logs nothing', async () => {
    const issued = await post('/canary/tokens', { label: 'sandbox', placement: 'isolated' });
    expect(issued.status).toBe(200);
    const { tokenId } = (await issued.json()) as { tokenId: string };

    const unknown = await canaryRoutes.handle(
      new Request(`http://localhost/canary/hit/${'0'.repeat(32)}`, {
        headers: { 'user-agent': 'scanner' },
      }),
    );
    expect(unknown.status).toBe(404);
    expect(logLines()).toHaveLength(0);

    const hit = await canaryRoutes.handle(
      new Request(`http://localhost/canary/hit/${tokenId}`, {
        headers: { 'user-agent': 'aws-cli/2', 'x-forwarded-for': '9.9.9.9' },
      }),
    );
    // Matching and non-matching ids must be indistinguishable to the caller.
    expect(hit.status).toBe(unknown.status);
    expect(await hit.text()).toBe(await unknown.text());
    const lines = logLines();
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0])).toMatchObject({
      tokenId,
      ua: 'aws-cli/2',
      forwardedFor: '9.9.9.9',
    });
  });

  test('admin API is refused for non-loopback, forwarded or unknown callers', async () => {
    resolvedIp = '203.0.113.5';
    const remote = await post('/canary/tokens', { label: 'x', placement: 'isolated' });
    expect(remote.status).toBe(403);
    const remoteList = await canaryRoutes.handle(new Request('http://localhost/canary/tokens'));
    expect(remoteList.status).toBe(403);
    expect(loadLedger().tokens).toHaveLength(0);

    resolvedIp = '127.0.0.1';
    const proxied = await canaryRoutes.handle(
      new Request('http://localhost/canary/tokens', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-forwarded-for': '198.51.100.2' },
        body: JSON.stringify({ label: 'x', placement: 'isolated' }),
      }),
    );
    expect(proxied.status).toBe(403);

    resolvedIp = null;
    const unknown = await post('/canary/stage/promote', {
      falsePositiveReview: {
        acknowledgedFalsePositiveReview: true,
        reviewer: 'ops',
        reviewedAt: '2026-10-13T00:00:00.000Z',
        isolatedHitCount: 0,
        falsePositiveCount: 0,
      },
    });
    expect(unknown.status).toBe(403);
    expect(loadLedger().stage).toBe('isolated');
  });

  test('the hit endpoint stays public for remote callers', async () => {
    resolvedIp = '203.0.113.5';
    const res = await canaryRoutes.handle(
      new Request(`http://localhost/canary/hit/${'2'.repeat(32)}`),
    );
    expect(res.status).toBe(404);
  });

  test('the hit endpoint is rate limited with 429', async () => {
    let last = 0;
    for (let i = 0; i < 40; i++) {
      const res = await canaryRoutes.handle(
        new Request(`http://localhost/canary/hit/${'1'.repeat(32)}`),
      );
      last = res.status;
    }
    expect(last).toBe(429);
  });

  test('promotion without review evidence is rejected with 400 and stays isolated', async () => {
    const missing = await post('/canary/stage/promote', {});
    expect(missing.status).toBeGreaterThanOrEqual(400);
    const bad = await post('/canary/stage/promote', {
      falsePositiveReview: {
        acknowledgedFalsePositiveReview: true,
        reviewer: '',
        reviewedAt: '2026-10-13T00:00:00.000Z',
        isolatedHitCount: 1,
        falsePositiveCount: 0,
      },
    });
    expect(bad.status).toBe(400);
    expect(loadLedger().stage).toBe('isolated');
  });

  test('production placement is rejected until a valid promotion', async () => {
    const denied = await post('/canary/tokens', { label: 'p', placement: 'production' });
    expect(denied.status).toBe(400);
    const ok = await post('/canary/stage/promote', {
      falsePositiveReview: {
        acknowledgedFalsePositiveReview: true,
        reviewer: 'ops',
        reviewedAt: '2026-10-13T00:00:00.000Z',
        isolatedHitCount: 0,
        falsePositiveCount: 0,
      },
    });
    expect(ok.status).toBe(200);
    const allowed = await post('/canary/tokens', { label: 'p', placement: 'production' });
    expect(allowed.status).toBe(200);
    const { tokenId } = (await allowed.json()) as { tokenId: string };
    expect(findToken(tokenId)?.placement).toBe('production');
  });
});
