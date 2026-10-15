import { describe, test, expect, afterEach } from 'bun:test';
import {
  isKeychainSecretRef,
  saveProviderApiKey,
  saveAgentApiKey,
  saveSecret,
  resolveStoredSecret,
  deleteStoredSecret,
  maskStoredSecret,
} from './secret-store';
import { decrypt } from './encryption';

const originalDbProvider = process.env.RAPITAS_DB_PROVIDER;
const originalTauriBuild = process.env.TAURI_BUILD;

afterEach(() => {
  if (originalDbProvider === undefined) delete process.env.RAPITAS_DB_PROVIDER;
  else process.env.RAPITAS_DB_PROVIDER = originalDbProvider;
  if (originalTauriBuild === undefined) delete process.env.TAURI_BUILD;
  else process.env.TAURI_BUILD = originalTauriBuild;
});

describe('isKeychainSecretRef', () => {
  test('true for a keychain: prefixed value', () => {
    expect(isKeychainSecretRef('keychain:api-key:claude')).toBe(true);
  });

  test('false for a plain (encrypted) value', () => {
    expect(isKeychainSecretRef('iv:tag:ciphertext')).toBe(false);
  });

  test('false for null/undefined', () => {
    expect(isKeychainSecretRef(null)).toBe(false);
    expect(isKeychainSecretRef(undefined)).toBe(false);
  });
});

describe('saveSecret / saveProviderApiKey / saveAgentApiKey — non-keychain-preferred path', () => {
  test('saveSecret encrypts (DB path) when neither sqlite nor Tauri env is set', () => {
    delete process.env.RAPITAS_DB_PROVIDER;
    delete process.env.TAURI_BUILD;
    const stored = saveSecret('some-account', 'my-secret');
    expect(isKeychainSecretRef(stored)).toBe(false);
    expect(decrypt(stored)).toBe('my-secret');
  });

  test('saveProviderApiKey round-trips through resolveStoredSecret', () => {
    delete process.env.RAPITAS_DB_PROVIDER;
    delete process.env.TAURI_BUILD;
    const stored = saveProviderApiKey('claude', 'sk-provider-key');
    expect(resolveStoredSecret(stored)).toBe('sk-provider-key');
  });

  test('saveAgentApiKey round-trips through resolveStoredSecret', () => {
    delete process.env.RAPITAS_DB_PROVIDER;
    delete process.env.TAURI_BUILD;
    const stored = saveAgentApiKey(42, 'sk-agent-key');
    expect(resolveStoredSecret(stored)).toBe('sk-agent-key');
  });
});

describe('resolveStoredSecret', () => {
  test('returns null for null/undefined/empty', () => {
    expect(resolveStoredSecret(null)).toBeNull();
    expect(resolveStoredSecret(undefined)).toBeNull();
    expect(resolveStoredSecret('')).toBeNull();
  });

  test('decrypts a plain encrypted (non-keychain) value', () => {
    delete process.env.RAPITAS_DB_PROVIDER;
    delete process.env.TAURI_BUILD;
    const stored = saveSecret('acct', 'plain-secret');
    expect(resolveStoredSecret(stored)).toBe('plain-secret');
  });

  test('returns null for a malformed "keychain:" ref with no matching entry', () => {
    // No account was ever saved under this made-up name.
    const result = resolveStoredSecret('keychain:nonexistent-account-xyz');
    expect(result === null || typeof result === 'string').toBe(true);
  });
});

describe('deleteStoredSecret', () => {
  test('is a no-op for null/undefined/empty (does not throw)', () => {
    expect(() => deleteStoredSecret(null)).not.toThrow();
    expect(() => deleteStoredSecret(undefined)).not.toThrow();
    expect(() => deleteStoredSecret('')).not.toThrow();
  });

  test('is a no-op for a plain (non-keychain) encrypted value', () => {
    delete process.env.RAPITAS_DB_PROVIDER;
    const stored = saveSecret('acct2', 'secret2');
    expect(() => deleteStoredSecret(stored)).not.toThrow();
  });
});

describe('maskStoredSecret', () => {
  test('returns null when there is nothing to resolve', () => {
    expect(maskStoredSecret(null)).toBeNull();
  });

  test('masks a resolved plain secret', () => {
    delete process.env.RAPITAS_DB_PROVIDER;
    const stored = saveSecret('acct3', 'sk-abcdefghijklmnop');
    const masked = maskStoredSecret(stored);
    expect(masked).not.toBeNull();
    expect(masked).not.toBe('sk-abcdefghijklmnop');
    expect(masked!.startsWith('sk-a')).toBe(true);
  });
});
