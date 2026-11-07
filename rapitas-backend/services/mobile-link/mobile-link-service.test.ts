/**
 * mobile-link-service tests (#1421)
 *
 * Turning the link on/off must open/close the gateway and the advertisement,
 * a pairing QR is only offered while on, and the status never leaks token
 * hashes.
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMobileLinkService } from './mobile-link-service';
import { createMobileLinkStore, type MobileLinkStore } from './mobile-link-store';
import { PAIRING_URI_PREFIX } from './pairing-payload';

let dir: string;
let store: MobileLinkStore;
let listening: number[];
let advertised: string[];
let failListen: Error | null;

function make() {
  return createMobileLinkService({
    store,
    listen: (port) => {
      if (failListen) throw failListen;
      listening.push(port);
      return { stop: () => void (listening = listening.filter((p) => p !== port)) };
    },
    advertise: (opts) => {
      advertised.push(opts.desktopId);
      return { stop: () => void (advertised = []) };
    },
    addresses: () => ['192.168.1.5'],
    desktopName: () => 'yuki-pc',
    forward: () => new Response('ok'),
  });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mobile-link-service-'));
  store = createMobileLinkStore(dir);
  listening = [];
  advertised = [];
  failListen = null;
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('enable / disable', () => {
  test('enable opens the gateway and advertises it; disable closes both', () => {
    const service = make();
    const on = service.enable();
    expect(on.enabled).toBe(true);
    expect(on.listening).toBe(true);
    expect(listening).toEqual([3002]);
    expect(advertised).toEqual([store.read().desktopId]);

    const off = service.disable();
    expect(off.enabled).toBe(false);
    expect(off.listening).toBe(false);
    expect(listening).toEqual([]);
    expect(advertised).toEqual([]);
  });

  test('a port already in use is reported, and the setting stays on for the next boot', () => {
    failListen = new Error('EADDRINUSE');
    const status = make().enable();
    expect(status.enabled).toBe(true);
    expect(status.listening).toBe(false);
    expect(status.lastError).toContain('EADDRINUSE');
  });

  test('startIfEnabled only starts when it was left on', () => {
    make().startIfEnabled();
    expect(listening).toEqual([]);
    store.update((s) => ({ ...s, enabled: true }));
    make().startIfEnabled();
    expect(listening).toEqual([3002]);
  });
});

describe('createPairing', () => {
  test('is refused while the link is off', async () => {
    expect(await make().createPairing(null)).toBeNull();
  });

  test('returns a pairing URI carrying the desktop id, addresses and port, plus an SVG', async () => {
    const service = make();
    service.enable();
    const pairing = await service.createPairing(null);
    expect(pairing).not.toBeNull();
    expect(pairing!.uri.startsWith(PAIRING_URI_PREFIX)).toBe(true);
    const payload = JSON.parse(
      Buffer.from(pairing!.uri.slice(PAIRING_URI_PREFIX.length), 'base64url').toString('utf8'),
    );
    expect(payload).toMatchObject({
      v: 1,
      id: store.read().desktopId,
      name: 'yuki-pc',
      port: 3002,
      hosts: ['192.168.1.5'],
    });
    expect(typeof payload.code).toBe('string');
    expect(pairing!.svg).toContain('<svg');
  });
});

test('status lists devices without their token hashes, and revoke removes one', () => {
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
  const service = make();
  expect(JSON.stringify(service.status())).not.toContain('tokenHash');
  expect(service.revoke('d1')).toBe(true);
  expect(service.revoke('d1')).toBe(false);
  expect(service.status().devices).toEqual([]);
});
