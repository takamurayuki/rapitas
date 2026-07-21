/**
 * encryption-key-resolver.fs-mocked.test
 *
 * Exercises the file-fallback, legacy-file-fallback, keychain-migration, and
 * key-generation branches of resolveEncryptionKey with `fs`, `os`, and
 * `@napi-rs/keyring` fully replaced by in-memory fakes. Unlike
 * encryption-key-resolver.test.ts (which routes only the keychain SERVICE
 * name to a throw-away value but still touches the real user-file path via
 * unmocked `fs`), this file never touches any real path or the real OS
 * keychain at all — safe to run on any machine, including ones that already
 * have a real ~/.rapitas/encryption.key or "rapitas" keychain entry.
 */
import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test';
import { join } from 'path';

let files: Map<string, string>;

function makeFsMock() {
  const existsSync = (p: string) => files.has(p);
  const readFileSync = (p: string) => {
    const v = files.get(p);
    if (v === undefined) throw new Error(`ENOENT: ${p}`);
    return v;
  };
  const writeFileSync = (p: string, v: string) => {
    files.set(p, v);
  };
  const mkdirSync = () => undefined;
  // Only referenced by config/logger's daily warn-sink, which is never
  // invoked in test mode (NODE_ENV=test) — a no-op stub is enough to satisfy
  // logger.ts's static `import { createWriteStream } from 'fs'`.
  const createWriteStream = () => ({ end: () => {}, write: () => {} });
  const impl = { existsSync, readFileSync, writeFileSync, mkdirSync, createWriteStream };
  // encryption-key-resolver.ts uses `import fs from 'fs'` (default import),
  // so both the named exports AND a `default` mirroring them are required.
  return { ...impl, default: impl };
}
mock.module('fs', makeFsMock);
mock.module('node:fs', makeFsMock);

function makeOsMock() {
  const homedir = () => '/fake-home';
  return { homedir, default: { homedir } };
}
mock.module('os', makeOsMock);
mock.module('node:os', makeOsMock);

let keyringAvailable: boolean;
let keyringStore: Map<string, string>;
let keyringSetShouldThrow: boolean;

class FakeEntry {
  constructor(
    private service: string,
    private account: string,
  ) {
    if (!keyringAvailable) throw new Error('keyring native binding unavailable');
  }
  getPassword(): string | null {
    return keyringStore.get(`${this.service}:${this.account}`) ?? null;
  }
  setPassword(v: string): void {
    if (keyringSetShouldThrow) throw new Error('keychain write failed');
    keyringStore.set(`${this.service}:${this.account}`, v);
  }
}
mock.module('@napi-rs/keyring', () => ({ Entry: FakeEntry }));

const { resolveEncryptionKey, getKeySource, __resetKeyCache } =
  await import('./encryption-key-resolver');

const USER_KEY_PATH = join('/fake-home', '.rapitas', 'encryption.key');
const LEGACY_KEY_PATH = join(__dirname, '..', '.encryption-key');
const VALID_A = 'a'.repeat(64);
const VALID_B = 'b'.repeat(64);

// A real ENCRYPTION_KEY is already configured in this dev environment (the
// backend's actual DB-encryption key) — it must be cleared for these tests
// so resolveEncryptionKey() actually exercises the file/keychain fallback
// chain instead of always short-circuiting at step 1 ("env").
const originalEnvKey = process.env.ENCRYPTION_KEY;

beforeEach(() => {
  delete process.env.ENCRYPTION_KEY;
  files = new Map();
  keyringAvailable = true;
  keyringStore = new Map();
  keyringSetShouldThrow = false;
  __resetKeyCache();
});

afterEach(() => {
  if (originalEnvKey === undefined) delete process.env.ENCRYPTION_KEY;
  else process.env.ENCRYPTION_KEY = originalEnvKey;
});

describe('resolveEncryptionKey — file/legacy-file/keychain fallback chain (fully mocked)', () => {
  it('reads from the OS keychain when a valid entry already exists', () => {
    keyringStore.set('rapitas:encryption-key', VALID_A);
    expect(resolveEncryptionKey()).toBe(VALID_A);
    expect(getKeySource()).toBe('keychain');
  });

  it('falls back to the user key file and migrates it into the keychain', () => {
    files.set(USER_KEY_PATH, VALID_A);
    expect(resolveEncryptionKey()).toBe(VALID_A);
    expect(getKeySource()).toBe('file');
    expect(keyringStore.get('rapitas:encryption-key')).toBe(VALID_A);
  });

  it('uses the user key file without migration when the keyring is unavailable', () => {
    keyringAvailable = false;
    files.set(USER_KEY_PATH, VALID_A);
    expect(resolveEncryptionKey()).toBe(VALID_A);
    expect(getKeySource()).toBe('file');
    expect(keyringStore.size).toBe(0);
  });

  it('does not crash when migrating a file key into the keychain fails', () => {
    keyringSetShouldThrow = true;
    files.set(USER_KEY_PATH, VALID_A);
    expect(resolveEncryptionKey()).toBe(VALID_A);
    expect(getKeySource()).toBe('file');
  });

  it('ignores a user file key of the wrong length and falls through to the legacy file', () => {
    files.set(USER_KEY_PATH, 'too-short');
    files.set(LEGACY_KEY_PATH, VALID_B);
    expect(resolveEncryptionKey()).toBe(VALID_B);
    expect(getKeySource()).toBe('legacy-file');
  });

  it('migrates a legacy file key into the keychain when available', () => {
    files.set(LEGACY_KEY_PATH, VALID_B);
    expect(resolveEncryptionKey()).toBe(VALID_B);
    expect(getKeySource()).toBe('legacy-file');
    expect(keyringStore.get('rapitas:encryption-key')).toBe(VALID_B);
  });

  it('migrates a legacy file key into the user file when the keyring is unavailable', () => {
    keyringAvailable = false;
    files.set(LEGACY_KEY_PATH, VALID_B);
    expect(resolveEncryptionKey()).toBe(VALID_B);
    expect(getKeySource()).toBe('legacy-file');
    expect(files.get(USER_KEY_PATH)).toBe(VALID_B);
  });

  it('generates a new key and persists it to the keychain when nothing else is present', () => {
    const key = resolveEncryptionKey();
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(getKeySource()).toBe('generated');
    expect(keyringStore.get('rapitas:encryption-key')).toBe(key);
    expect(files.has(USER_KEY_PATH)).toBe(false);
  });

  it('falls back to writing the user file when keychain persistence fails after generating', () => {
    keyringSetShouldThrow = true;
    const key = resolveEncryptionKey();
    expect(getKeySource()).toBe('generated');
    expect(files.get(USER_KEY_PATH)).toBe(key);
  });

  it('writes the generated key straight to the user file when the keyring is unavailable', () => {
    keyringAvailable = false;
    const key = resolveEncryptionKey();
    expect(getKeySource()).toBe('generated');
    expect(files.get(USER_KEY_PATH)).toBe(key);
  });

  it('still returns a usable key (in memory only) when both keychain and file persistence fail', () => {
    keyringAvailable = false;
    const originalWriteFileSync = files.set.bind(files);
    // Simulate a write failure by making the underlying map throw on set.
    files.set = () => {
      throw new Error('disk full');
    };
    try {
      const key = resolveEncryptionKey();
      expect(key).toMatch(/^[0-9a-f]{64}$/);
      expect(getKeySource()).toBe('generated');
    } finally {
      files.set = originalWriteFileSync;
    }
  });
});
