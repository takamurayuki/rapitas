import { describe, test, expect } from 'bun:test';
import { encrypt, decrypt, maskApiKey, isEncryptionKeyConfigured } from './encryption';

describe('encrypt / decrypt', () => {
  test('round-trips a simple string', () => {
    const plain = 'my-secret-api-key';
    expect(decrypt(encrypt(plain))).toBe(plain);
  });

  test('round-trips an empty string', () => {
    expect(decrypt(encrypt(''))).toBe('');
  });

  test('round-trips unicode content', () => {
    const plain = '秘密のAPIキー🔑';
    expect(decrypt(encrypt(plain))).toBe(plain);
  });

  test('produces a different ciphertext each time (random IV)', () => {
    const a = encrypt('same input');
    const b = encrypt('same input');
    expect(a).not.toBe(b);
    expect(decrypt(a)).toBe('same input');
    expect(decrypt(b)).toBe('same input');
  });

  test('output has the iv:authTag:ciphertext format', () => {
    const encrypted = encrypt('x');
    expect(encrypted.split(':')).toHaveLength(3);
  });

  test('decrypt throws on a malformed (wrong part count) string', () => {
    expect(() => decrypt('only-one-part')).toThrow('Invalid encrypted text format');
    expect(() => decrypt('a:b')).toThrow('Invalid encrypted text format');
    expect(() => decrypt('a:b:c:d')).toThrow('Invalid encrypted text format');
  });

  test('decrypt throws when the auth tag has been tampered with', () => {
    const [iv, , ciphertext] = encrypt('tamper me').split(':');
    const tampered = `${iv}:00112233445566778899aabbccddeeff:${ciphertext}`;
    expect(() => decrypt(tampered)).toThrow();
  });
});

describe('maskApiKey', () => {
  test('masks a long key, keeping first 4 and last 4 chars', () => {
    expect(maskApiKey('sk-abcdefghijklmnop')).toBe(
      `sk-a${'*'.repeat('sk-abcdefghijklmnop'.length - 8)}mnop`,
    );
  });

  test('returns *** for a key of length <= 8', () => {
    expect(maskApiKey('short')).toBe('***');
    expect(maskApiKey('12345678')).toBe('***');
  });

  test('masks a key of exactly 9 characters', () => {
    const key = '123456789';
    const masked = maskApiKey(key);
    expect(masked.startsWith('1234')).toBe(true);
    expect(masked.endsWith('6789')).toBe(true);
    expect(masked).toBe('1234*6789');
  });
});

describe('isEncryptionKeyConfigured', () => {
  test('reports true when a 64-char key is resolved (test env always resolves one)', () => {
    expect(isEncryptionKeyConfigured()).toBe(true);
  });
});
