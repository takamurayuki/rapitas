/**
 * mobile-gateway tests (#1421)
 *
 * The LAN front door's contract: only a paired device's token gets through,
 * a QR code is spent exactly once, management routes are unreachable from
 * the LAN, and browsers are refused outright.
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGatewayHandler } from './mobile-gateway';
import {
  createMobileLinkStore,
  type MobileLinkStore,
  type PairedDevice,
} from './mobile-link-store';
import { createPairingCodes, type PairingCodes } from './pairing-codes';

let dir: string;
let store: MobileLinkStore;
let codes: PairingCodes;
let clock: number;
let forwarded: Array<{ path: string; device: PairedDevice }>;
let handle: ReturnType<typeof createGatewayHandler>;

function req(path: string, init: RequestInit = {}) {
  return new Request(`http://192.168.1.5:3002${path}`, init);
}

async function claim(code: string, deviceName = 'iPhone') {
  const res = await handle(
    req('/mobile-link/claim', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, deviceName }),
    }),
  );
  return { status: res.status, body: (await res.json()) as Record<string, string> };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mobile-gateway-'));
  store = createMobileLinkStore(dir);
  store.update((s) => ({ ...s, enabled: true }));
  clock = 1_000_000;
  codes = createPairingCodes(() => clock);
  forwarded = [];
  handle = createGatewayHandler({
    store,
    codes,
    desktopName: () => 'yuki-pc',
    now: () => clock,
    forward: (request, device) => {
      forwarded.push({ path: new URL(request.url).pathname, device });
      return new Response('ok');
    },
  });
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('pairing', () => {
  test('a live code issues a token that then opens the gateway', async () => {
    const { code } = codes.create(7);
    const paired = await claim(code);
    expect(paired.status).toBe(201);
    expect(paired.body.desktopId).toBe(store.read().desktopId);
    expect(paired.body.desktopName).toBe('yuki-pc');

    const res = await handle(
      req('/tasks', { headers: { Authorization: `Bearer ${paired.body.token}` } }),
    );
    expect(res.status).toBe(200);
    expect(forwarded[0].path).toBe('/tasks');
    expect(forwarded[0].device.workspaceId).toBe(7);
    expect(forwarded[0].device.name).toBe('iPhone');
  });

  test('a code works once', async () => {
    const { code } = codes.create(null);
    expect((await claim(code)).status).toBe(201);
    expect((await claim(code)).status).toBe(401);
  });

  test('an expired code is refused', async () => {
    const { code } = codes.create(null);
    clock += 5 * 60 * 1000 + 1;
    const res = await claim(code);
    expect(res.status).toBe(401);
    expect(res.body.error).toContain('expired');
  });

  test('a wrong code does not burn the live one', async () => {
    const { code } = codes.create(null);
    expect((await claim('not-the-code')).status).toBe(401);
    expect((await claim(code)).status).toBe(201);
  });

  test('the raw token is never written to disk', async () => {
    const { code } = codes.create(null);
    const { body } = await claim(code);
    const file = readFileSync(join(dir, 'mobile-link.json'), 'utf8');
    expect(file).not.toContain(body.token);
    expect(store.read().devices).toHaveLength(1);
  });
});

describe('access control', () => {
  test('no token, an unknown token, or a revoked token is refused', async () => {
    expect((await handle(req('/tasks'))).status).toBe(401);
    expect(
      (await handle(req('/tasks', { headers: { Authorization: 'Bearer nope' } }))).status,
    ).toBe(401);

    const { code } = codes.create(null);
    const { body } = await claim(code);
    store.update((s) => ({ ...s, devices: [] }));
    const res = await handle(req('/tasks', { headers: { Authorization: `Bearer ${body.token}` } }));
    expect(res.status).toBe(401);
    expect(forwarded).toHaveLength(0);
  });

  test('management routes are unreachable even with a valid token', async () => {
    const { code } = codes.create(null);
    const { body } = await claim(code);
    const auth = { Authorization: `Bearer ${body.token}` };
    expect(
      (await handle(req('/mobile-link/pairing', { method: 'POST', headers: auth }))).status,
    ).toBe(404);
    expect((await handle(req('/mobile-link', { headers: auth }))).status).toBe(404);
    expect(forwarded).toHaveLength(0);
  });

  test('browser requests (with Origin) are refused before anything else', async () => {
    const { code } = codes.create(null);
    const res = await handle(
      req('/mobile-link/claim', {
        method: 'POST',
        headers: { Origin: 'http://evil.example', 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      }),
    );
    expect(res.status).toBe(403);
    // The code survives a refused browser attempt.
    expect((await claim(code)).status).toBe(201);
  });

  test('nothing gets through while the link is off', async () => {
    const { code } = codes.create(null);
    const { body } = await claim(code);
    store.update((s) => ({ ...s, enabled: false }));
    const res = await handle(req('/tasks', { headers: { Authorization: `Bearer ${body.token}` } }));
    expect(res.status).toBe(503);
  });
});

test('lastSeenAt is recorded, at most once a minute', async () => {
  const { code } = codes.create(null);
  const { body } = await claim(code);
  const auth = { Authorization: `Bearer ${body.token}` };
  await handle(req('/tasks', { headers: auth }));
  const first = store.read().devices[0].lastSeenAt;
  expect(first).not.toBeNull();
  clock += 30_000;
  await handle(req('/tasks', { headers: auth }));
  expect(store.read().devices[0].lastSeenAt).toBe(first);
  clock += 31_000;
  await handle(req('/tasks', { headers: auth }));
  expect(store.read().devices[0].lastSeenAt).not.toBe(first);
});
