/**
 * mobile-link-store tests (#1421)
 *
 * The desktop id must survive restarts (phones find the desktop by it), and a
 * damaged file must not crash the backend.
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMobileLinkStore, DEFAULT_GATEWAY_PORT } from './mobile-link-store';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mobile-link-store-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('createMobileLinkStore', () => {
  test('starts off, on the default port, with no devices', () => {
    const state = createMobileLinkStore(dir).read();
    expect(state.enabled).toBe(false);
    expect(state.gatewayPort).toBe(DEFAULT_GATEWAY_PORT);
    expect(state.devices).toEqual([]);
  });

  test('the desktop id is stable across store instances (i.e. restarts)', () => {
    const first = createMobileLinkStore(dir).read().desktopId;
    expect(createMobileLinkStore(dir).read().desktopId).toBe(first);
  });

  test('updates persist', () => {
    createMobileLinkStore(dir).update((s) => ({ ...s, enabled: true }));
    expect(createMobileLinkStore(dir).read().enabled).toBe(true);
  });

  test('a corrupt file reads as a fresh state instead of throwing', () => {
    writeFileSync(join(dir, 'mobile-link.json'), '{not json');
    expect(createMobileLinkStore(dir).read().enabled).toBe(false);
  });

  test('update does not mutate the previous state object', () => {
    const store = createMobileLinkStore(dir);
    const before = store.read();
    store.update((s) => {
      s.enabled = true;
      return s;
    });
    expect(before.enabled).toBe(false);
  });
});
