/**
 * browser-url-policy.test
 *
 * The frontend mirror of the Rust entry policy: the "refused list" of nav60
 * §9 never becomes a tab, other local dev servers stay open (Q8), and the
 * address bar searches anything that is not a URL (Q4).
 */
import { describe, it, expect, vi } from 'vitest';

// A non-loopback API origin, so the "own origins" rule is what refuses it
// (a 127.0.0.1:3001 base would already be caught by the loopback rule).
vi.mock('@/utils/api', () => ({ API_BASE_URL: 'https://api.rapitas.test/v1' }));

import {
  browserUrlRefusal,
  canOpenInBrowser,
  isLoopbackAlias,
  resolveAddressInput,
  SEARCH_URL,
} from '../browser-url-policy';

describe('browserUrlRefusal', () => {
  it.each([
    'javascript:alert(1)',
    'file:///etc/hosts',
    'data:text/html,<p>x</p>',
    'tauri://localhost',
    'blob:https://example.com/123',
    'not a url',
  ])('refuses the non-web %s', (url) => {
    expect(browserUrlRefusal(url)).toBe('scheme');
  });

  it.each([
    'http://tauri.localhost/',
    'https://tauri.localhost/tasks',
    'http://127.0.0.1:3000/',
    'http://localhost:3000/',
    'http://127.0.0.1:3001/tasks',
    'http://localhost:3001',
    'http://[::1]:3001/',
    'http://127.1:3001/',
    'http://0.0.0.0:3000/',
    'http://app.localhost:3000/',
    'http://[::ffff:127.0.0.1]:3001/',
  ])('refuses the app or backend at %s', (url) => {
    expect(browserUrlRefusal(url)).toBe('app-origin');
  });

  it('refuses the configured API origin even when it is not a loopback one', () => {
    expect(browserUrlRefusal('https://api.rapitas.test/tasks')).toBe('app-origin');
    expect(browserUrlRefusal('https://rapitas.test/')).toBeNull();
  });

  it("refuses the web app's own origin (window.location.origin)", () => {
    expect(browserUrlRefusal(`${window.location.origin}/kanban`)).toBe('app-origin');
  });

  it.each([
    'https://github.com/takamurayuki/rapitas',
    'http://localhost:5173/',
    'http://127.0.0.1:8080/',
    'https://example.com:3000/',
  ])('allows %s', (url) => {
    expect(canOpenInBrowser(url)).toBe(true);
  });
});

describe('isLoopbackAlias', () => {
  it('recognises loopback spellings and nothing else', () => {
    for (const h of ['localhost', 'x.localhost', '127.0.0.1', '127.9.9.9', '[::1]', '0.0.0.0']) {
      expect(isLoopbackAlias(h)).toBe(true);
    }
    for (const h of ['example.com', '10.0.0.1', 'localhost.example.com']) {
      expect(isLoopbackAlias(h)).toBe(false);
    }
  });
});

describe('resolveAddressInput', () => {
  it.each([
    ['example.com', 'https://example.com/'],
    ['https://github.com/a/b', 'https://github.com/a/b'],
    ['localhost:5173', 'https://localhost:5173/'],
    ['docs.example.com/path?q=1', 'https://docs.example.com/path?q=1'],
  ])('opens the URL %s', (typed, expected) => {
    expect(resolveAddressInput(typed)).toBe(expected);
  });

  it.each(['rust ownership', 'tauri', '東京 天気'])('searches the phrase %s', (typed) => {
    expect(resolveAddressInput(typed)).toBe(`${SEARCH_URL}${encodeURIComponent(typed)}`);
  });

  it('returns a non-web scheme as typed, so the policy refuses it visibly', () => {
    expect(resolveAddressInput('javascript:alert(1)')).toBe('javascript:alert(1)');
    expect(resolveAddressInput('mailto:a@b.c')).toBe('mailto:a@b.c');
  });

  it('ignores an empty entry', () => {
    expect(resolveAddressInput('   ')).toBeNull();
  });
});
