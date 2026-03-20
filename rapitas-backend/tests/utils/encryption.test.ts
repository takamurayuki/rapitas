/**
 * Encryption Utilities テスト
 * 暗号化/復号化およびAPIキーマスクのテスト
 *
 * Note: encrypt/decrypt関数はモジュールレベルでENCRYPTION_KEYが必要。
 * テスト環境では環境変数が設定済みであることを前提とする。
 * maskApiKeyとisEncryptionKeyConfiguredは独立してテスト可能。
 */
import { describe, test, expect } from 'bun:test';
import { encrypt, decrypt, maskApiKey, isEncryptionKeyConfigured } from '../../utils/common/encryption';

describe('encrypt / decrypt', () => {
  test('暗号化と復号化のラウンドトリップが正しく動作すること', () => {
    const plainText = 'sk-ant-api03-test-key-12345';
    const encrypted = encrypt(plainText);
    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(plainText);
  });

  test('暗号化結果がIV:AuthTag:暗号文のフォーマットであること', () => {
    const encrypted = encrypt('test');
    const parts = encrypted.split(':');
    expect(parts.length).toBe(3);
    // IV is 32-char hex (16 bytes)
    expect(parts[0]!.length).toBe(32);
    // AuthTag is 32-char hex (16 bytes)
    expect(parts[1]!.length).toBe(32);
    // Ciphertext should exist
    expect(parts[2]!.length).toBeGreaterThan(0);
  });

  test('同じ平文でも異なる暗号文が生成されること（IV がランダム）', () => {
    const plainText = 'same-text';
    const encrypted1 = encrypt(plainText);
    const encrypted2 = encrypt(plainText);
    expect(encrypted1).not.toBe(encrypted2);
    // But both should decrypt to the same plaintext
    expect(decrypt(encrypted1)).toBe(plainText);
    expect(decrypt(encrypted2)).toBe(plainText);
  });

  test('空文字列の暗号化・復号化が動作すること', () => {
    const encrypted = encrypt('');
    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe('');
  });

  test('日本語テキストの暗号化・復号化が動作すること', () => {
    const plainText = '日本語のAPIキー説明';
    const encrypted = encrypt(plainText);
    const decrypted = decrypt(encrypted);
    expect(decrypted).toBe(plainText);
  });

  test('不正なフォーマットでdecryptがエラーをスローすること', () => {
    expect(() => decrypt('invalid-format')).toThrow('Invalid encrypted text format');
    expect(() => decrypt('only:two')).toThrow('Invalid encrypted text format');
  });
});

describe('maskApiKey', () => {
  test('通常の長さのキーをマスクすること', () => {
    const result = maskApiKey('sk-ant-api03-test-key-12345');
    expect(result.startsWith('sk-a')).toBe(true);
    expect(result.endsWith('2345')).toBe(true);
    expect(result).toContain('*');
    // First 4 chars + mask + last 4 chars
    expect(result.length).toBe('sk-ant-api03-test-key-12345'.length);
  });

  test('8文字以下のキーで***を返すこと', () => {
    expect(maskApiKey('short')).toBe('***');
    expect(maskApiKey('12345678')).toBe('***');
  });

  test('ちょうど9文字のキーをマスクすること', () => {
    const result = maskApiKey('123456789');
    expect(result).toBe('1234*6789');
  });
});

describe('isEncryptionKeyConfigured', () => {
  test('ENCRYPTION_KEYが設定されている場合trueを返すこと', () => {
    // Assumes ENCRYPTION_KEY is set in the test environment
    expect(isEncryptionKeyConfigured()).toBe(true);
  });
});
