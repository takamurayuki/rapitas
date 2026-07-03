/**
 * secret-store テスト
 * APIキー保存（暗号化DB / OSキーチェーン）・解決・マスク処理のテスト
 *
 * Note: `saveSecret`/`resolveStoredSecret`はデフォルトで暗号化DB経路を使う
 * （isDesktopKeychainPreferred()がfalseの環境）。OSキーチェーン経路は
 * SERVICE_NAMEがモジュールロード時に固定されるため、実PCの"rapitas"サービスを
 * 汚さないよう専用サービス名でモジュールを動的インポートして検証する。
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import {
  isKeychainSecretRef,
  saveProviderApiKey,
  saveAgentApiKey,
  saveSecret,
  resolveStoredSecret,
  deleteStoredSecret,
  maskStoredSecret,
} from '../../utils/common/secret-store';

describe('isKeychainSecretRef', () => {
  test('keychain: プレフィックス付きの値で true を返すこと', () => {
    expect(isKeychainSecretRef('keychain:api-key:openai')).toBe(true);
  });

  test('プレフィックスなしの値で false を返すこと', () => {
    expect(isKeychainSecretRef('abcd1234:ef567890:ciphertext')).toBe(false);
  });

  test('null / undefined / 空文字列で false を返すこと', () => {
    expect(isKeychainSecretRef(null)).toBe(false);
    expect(isKeychainSecretRef(undefined)).toBe(false);
    expect(isKeychainSecretRef('')).toBe(false);
  });
});

describe('saveSecret / resolveStoredSecret - 暗号化DB経路（デフォルト）', () => {
  const originalDbProvider = process.env.RAPITAS_DB_PROVIDER;
  const originalTauriBuild = process.env.TAURI_BUILD;

  beforeEach(() => {
    // Ensure the keychain-preferred branch is off so these tests exercise the
    // plain encrypt()/decrypt() fallback deterministically.
    delete process.env.RAPITAS_DB_PROVIDER;
    delete process.env.TAURI_BUILD;
  });

  afterEach(() => {
    if (originalDbProvider === undefined) delete process.env.RAPITAS_DB_PROVIDER;
    else process.env.RAPITAS_DB_PROVIDER = originalDbProvider;
    if (originalTauriBuild === undefined) delete process.env.TAURI_BUILD;
    else process.env.TAURI_BUILD = originalTauriBuild;
  });

  test('保存した値は keychain: プレフィックスを持たないこと', () => {
    const stored = saveSecret('unit-test-account', 'dummy-secret-value');
    expect(isKeychainSecretRef(stored)).toBe(false);
  });

  test('保存と解決のラウンドトリップが正しく動作すること', () => {
    const stored = saveSecret('unit-test-account', 'dummy-secret-value');
    expect(resolveStoredSecret(stored)).toBe('dummy-secret-value');
  });

  test('saveProviderApiKey で保存した値を解決できること', () => {
    const stored = saveProviderApiKey('openai', 'dummy-provider-key');
    expect(resolveStoredSecret(stored)).toBe('dummy-provider-key');
  });

  test('saveAgentApiKey で保存した値を解決できること', () => {
    const stored = saveAgentApiKey(42, 'dummy-agent-key');
    expect(resolveStoredSecret(stored)).toBe('dummy-agent-key');
  });

  test('resolveStoredSecret は null / undefined / 空文字列で null を返すこと', () => {
    expect(resolveStoredSecret(null)).toBeNull();
    expect(resolveStoredSecret(undefined)).toBeNull();
    expect(resolveStoredSecret('')).toBeNull();
  });

  test('keychain: のみ（アカウント部分が空）の場合は例外を投げず null を返すこと', () => {
    // NOTE: regression test for a fixed bug — accountFromRef('keychain:') used
    // to return '' which the old truthy check treated as "not a keychain ref",
    // falling through to decrypt() and throwing "Invalid encrypted text format".
    expect(resolveStoredSecret('keychain:')).toBeNull();
  });

  test('deleteStoredSecret は非keychain参照に対して何もしない（例外を投げない）こと', () => {
    const stored = saveSecret('unit-test-account-delete', 'dummy-secret-value');
    expect(() => deleteStoredSecret(stored)).not.toThrow();
  });

  test('deleteStoredSecret は null / undefined に対して何もしないこと', () => {
    expect(() => deleteStoredSecret(null)).not.toThrow();
    expect(() => deleteStoredSecret(undefined)).not.toThrow();
  });

  test('maskStoredSecret は保存済み値をマスクして返すこと', () => {
    const stored = saveSecret('unit-test-account-mask', 'dummy-secret-value-1234');
    const masked = maskStoredSecret(stored);
    expect(masked).not.toBeNull();
    expect(masked).toContain('*');
    expect(masked).not.toBe('dummy-secret-value-1234');
  });

  test('maskStoredSecret は null / undefined で null を返すこと', () => {
    expect(maskStoredSecret(null)).toBeNull();
    expect(maskStoredSecret(undefined)).toBeNull();
  });
});

describe('saveSecret / resolveStoredSecret / deleteStoredSecret - OSキーチェーン経路', () => {
  // Route through a throw-away keychain service so this test never touches
  // the real "rapitas" entry on a developer's machine.
  const TEST_SERVICE = 'rapitas-test-secretstore';
  const MODULE_PATH = '../../utils/common/secret-store';

  const originalKeychainService = process.env.RAPITAS_KEYCHAIN_SERVICE;
  const originalDbProvider = process.env.RAPITAS_DB_PROVIDER;

  async function freshKeychainModule() {
    process.env.RAPITAS_KEYCHAIN_SERVICE = TEST_SERVICE;
    process.env.RAPITAS_DB_PROVIDER = 'sqlite'; // forces isDesktopKeychainPreferred() === true
    // Cache-bust so SERVICE_NAME (a module-level const) is re-evaluated with
    // the env vars set above.
    return import(`${MODULE_PATH}?cb=${Date.now()}-${Math.random()}`);
  }

  /** Best-effort cleanup of any throw-away keychain entry left by these tests. */
  function clearTestKeychainEntry(account: string) {
    try {
      const mod = require('@napi-rs/keyring') as typeof import('@napi-rs/keyring');
      new mod.Entry(TEST_SERVICE, account).deletePassword();
    } catch {
      /* no entry to delete */
    }
  }

  afterEach(() => {
    if (originalKeychainService === undefined) delete process.env.RAPITAS_KEYCHAIN_SERVICE;
    else process.env.RAPITAS_KEYCHAIN_SERVICE = originalKeychainService;
    if (originalDbProvider === undefined) delete process.env.RAPITAS_DB_PROVIDER;
    else process.env.RAPITAS_DB_PROVIDER = originalDbProvider;
  });

  test('OSキーチェーンが利用可能な場合 keychain: 参照を返し、解決・削除できること', async () => {
    const mod = await freshKeychainModule();
    const account = 'unit-test-keychain-account';
    try {
      const stored: string = mod.saveSecret(account, 'dummy-keychain-secret');

      if (!isKeychainSecretRef(stored)) {
        // Platform has no usable OS keychain binding (e.g. headless CI) —
        // saveSecret already fell back to the encrypted-DB path, which is
        // covered by the suite above. Nothing more to assert here.
        return;
      }

      expect(stored).toBe(`keychain:${account}`);
      expect(mod.resolveStoredSecret(stored)).toBe('dummy-keychain-secret');

      mod.deleteStoredSecret(stored);
      expect(mod.resolveStoredSecret(stored)).toBeNull();
    } finally {
      clearTestKeychainEntry(account);
    }
  });

  test('resolveStoredSecret はキーチェーンに存在しないアカウントで null を返すこと', async () => {
    const mod = await freshKeychainModule();
    const ref = 'keychain:never-saved-account';
    const result: string | null = mod.resolveStoredSecret(ref);
    // Either the platform has no keychain at all (tryCreateEntry -> null) or
    // the keychain has no such entry (getPassword -> null) — both are null.
    expect(result).toBeNull();
  });
});
