import { describe, test, expect, afterEach, beforeEach } from 'bun:test';

// CRITICAL: route any keychain interaction this file triggers into a
// throw-away service. Without this override, a test run with no
// ENCRYPTION_KEY set falls through to the REAL OS keychain entry
// (service="rapitas", account="encryption-key") that the actual running app
// uses for its master DB-encryption key — confirmed present on dev machines
// via `cmdkey /list`. On a machine where that entry does not exist (e.g. a
// fresh CI runner), the same fallthrough would instead GENERATE a brand-new
// key and persist it into the real keychain/file as a side effect of
// running tests. Matches the existing safety pattern in
// tests/utils/encryption-key-resolver.test.ts.
process.env.RAPITAS_KEYCHAIN_SERVICE = 'rapitas-test';

const { resolveEncryptionKey, getKeySource, __resetKeyCache } =
  await import('./encryption-key-resolver');

const originalKey = process.env.ENCRYPTION_KEY;

/** Wipe any throw-away keychain entry written by the resolver during tests. */
function clearTestKeychainEntry() {
  try {
    const mod = require('@napi-rs/keyring') as typeof import('@napi-rs/keyring');
    new mod.Entry('rapitas-test', 'encryption-key').deletePassword();
  } catch {
    /* no entry to delete / keyring unavailable on this platform */
  }
}

beforeEach(() => {
  __resetKeyCache();
});

afterEach(() => {
  if (originalKey === undefined) delete process.env.ENCRYPTION_KEY;
  else process.env.ENCRYPTION_KEY = originalKey;
  __resetKeyCache();
  clearTestKeychainEntry();
});

describe('resolveEncryptionKey / getKeySource', () => {
  test('getKeySource returns null before resolveEncryptionKey has been called', () => {
    expect(getKeySource()).toBeNull();
  });

  test('resolves and reports "env" when a valid 64-char ENCRYPTION_KEY is set', () => {
    process.env.ENCRYPTION_KEY = 'a'.repeat(64);
    expect(resolveEncryptionKey()).toBe('a'.repeat(64));
    expect(getKeySource()).toBe('env');
  });

  test('ignores an ENCRYPTION_KEY of the wrong length and falls through', () => {
    process.env.ENCRYPTION_KEY = 'too-short';
    const key = resolveEncryptionKey();
    expect(key).not.toBe('too-short');
    expect(key).toHaveLength(64);
    expect(getKeySource()).not.toBe('env');
  });

  test('caches the resolved key across repeated calls', () => {
    process.env.ENCRYPTION_KEY = 'b'.repeat(64);
    const first = resolveEncryptionKey();
    process.env.ENCRYPTION_KEY = 'c'.repeat(64); // changing env after first resolution
    const second = resolveEncryptionKey();
    expect(second).toBe(first); // still the cached value, env change ignored
  });

  test('__resetKeyCache clears the cache so a new env value takes effect', () => {
    process.env.ENCRYPTION_KEY = 'd'.repeat(64);
    const first = resolveEncryptionKey();
    __resetKeyCache();
    process.env.ENCRYPTION_KEY = 'e'.repeat(64);
    const second = resolveEncryptionKey();
    expect(second).not.toBe(first);
    expect(second).toBe('e'.repeat(64));
  });

  test('always resolves to a 64-hex-char key even with no env override', () => {
    delete process.env.ENCRYPTION_KEY;
    const key = resolveEncryptionKey();
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });
});
