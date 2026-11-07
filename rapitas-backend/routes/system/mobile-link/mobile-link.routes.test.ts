/**
 * mobile-link routes tests (#1421)
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMobileLinkRoutes } from './mobile-link.routes';
import {
  createMobileLinkService,
  type MobileLinkService,
} from '../../../services/mobile-link/mobile-link-service';
import { createMobileLinkStore } from '../../../services/mobile-link/mobile-link-store';

let dir: string;
let service: MobileLinkService | null;
let app: ReturnType<typeof createMobileLinkRoutes>;

async function call(method: string, path = '') {
  const res = await app.handle(new Request(`http://localhost/mobile-link${path}`, { method }));
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mobile-link-routes-'));
  const store = createMobileLinkStore(dir);
  store.update((s) => ({
    ...s,
    devices: [
      {
        id: 'd1',
        name: 'iPhone',
        tokenHash: 'abc',
        workspaceId: null,
        createdAt: 'x',
        lastSeenAt: null,
      },
    ],
  }));
  service = createMobileLinkService({
    store,
    listen: () => ({ stop() {} }),
    advertise: () => ({ stop() {} }),
    addresses: () => ['192.168.1.5'],
    desktopName: () => 'pc',
    forward: () => new Response('ok'),
  });
  app = createMobileLinkRoutes(() => service);
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('/mobile-link', () => {
  test('status, enable, pairing, revoke', async () => {
    expect((await call('GET')).body.enabled).toBe(false);
    expect((await call('POST', '/pairing')).status).toBe(409);

    expect((await call('POST', '/enable')).body.listening).toBe(true);
    const pairing = await call('POST', '/pairing');
    expect(pairing.status).toBe(200);
    expect(String(pairing.body.uri)).toStartWith('rapitas://pair?d=');

    expect((await call('DELETE', '/devices/d1')).status).toBe(200);
    expect((await call('DELETE', '/devices/d1')).status).toBe(404);
    expect((await call('POST', '/disable')).body.enabled).toBe(false);
  });

  test('answers 503 in a process without the service', async () => {
    service = null;
    expect((await call('GET')).status).toBe(503);
  });
});
