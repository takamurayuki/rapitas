/**
 * Encryption Key Resolver テスト
 *
 * Verifies the hybrid resolution chain falls through correctly when the
 * preferred sources are absent.
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';

// Route any keychain interaction this test triggers into a throw-away service
// so we never touch the real "rapitas" entry on a developer's machine.
process.env.RAPITAS_KEYCHAIN_SERVICE = 'rapitas-test';

const MODULE_PATH = '../../utils/common/encryption-key-resolver';

const VALID_KEY_A = 'a'.repeat(64);
const VALID_KEY_B = 'b'.repeat(64);

async function freshResolver() {
  // Force re-import so module-level state is reset per test.
  const mod = await import(`${MODULE_PATH}?cb=${Date.now()}-${Math.random()}`);
  mod.__resetKeyCache();
  return mod;
}

/** Wipe any throw-away keychain entry written by the resolver during tests. */
function clearTestKeychainEntry() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@napi-rs/keyring') as typeof import('@napi-rs/keyring');
    new mod.Entry('rapitas-test', 'encryption-key').deletePassword();
  } catch {
    /* no entry to delete */
  }
}

describe('resolveEncryptionKey', () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env.ENCRYPTION_KEY;
  });

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = originalEnv;
    clearTestKeychainEntry();
  });

  test('env varが設定されているときは env が選ばれる', async () => {
    process.env.ENCRYPTION_KEY = VALID_KEY_A;
    const { resolveEncryptionKey, getKeySource, __resetKeyCache } = await freshResolver();
    __resetKeyCache();
    expect(resolveEncryptionKey()).toBe(VALID_KEY_A);
    expect(getKeySource()).toBe('env');
  });

  test('長さが不正な env varは無視される', async () => {
    process.env.ENCRYPTION_KEY = 'too-short';
    const { resolveEncryptionKey, getKeySource, __resetKeyCache } = await freshResolver();
    __resetKeyCache();
    const v = resolveEncryptionKey();
    // Must fall through to another source — either keychain, file, or generated.
    expect(v.length).toBe(64);
    expect(getKeySource()).not.toBe('env');
  });

  test('結果はキャッシュされ複数回呼び出しても同じ値を返す', async () => {
    process.env.ENCRYPTION_KEY = VALID_KEY_B;
    const { resolveEncryptionKey, __resetKeyCache } = await freshResolver();
    __resetKeyCache();
    const a = resolveEncryptionKey();
    const b = resolveEncryptionKey();
    expect(a).toBe(b);
  });
});
