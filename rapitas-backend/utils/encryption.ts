/**
 * Encryption Utility
 *
 * Encrypts and decrypts sensitive information such as API keys.
 */

import crypto from 'crypto';

// NOTE: Encryption key must come from environment variable. Startup is rejected if unset (security requirement).
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
if (!ENCRYPTION_KEY) {
  throw new Error(
    'ENCRYPTION_KEY environment variable is not set. ' +
      "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\" " +
      'and set it in your .env file.',
  );
}
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

/**
 * Encrypt a string.
 */
export function encrypt(text: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const key = Buffer.from(String(ENCRYPTION_KEY).slice(0, 64), 'hex');

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag();

  // Concatenate IV + AuthTag + ciphertext
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

/**
 * Decrypt an encrypted string.
 */
export function decrypt(encryptedText: string): string {
  const parts = encryptedText.split(':');
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted text format');
  }

  // parts[0..2] are guaranteed by the length check above, assert non-null for TS
  const iv = Buffer.from(parts[0]!, 'hex');
  const authTag = Buffer.from(parts[1]!, 'hex');
  const encrypted = parts[2]!;
  const key = Buffer.from(String(ENCRYPTION_KEY).slice(0, 64), 'hex');

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  // Force returned chunks to string to avoid Buffer/string overload issues
  const first = decipher.update(encrypted, 'hex', 'utf8') as string;
  const last = decipher.final('utf8') as string;

  return first + last;
}

/**
 * Mask an API key for display purposes.
 */
export function maskApiKey(key: string): string {
  if (key.length <= 8) {
    return '***';
  }
  return `${key.slice(0, 4)}${'*'.repeat(key.length - 8)}${key.slice(-4)}`;
}

/**
 * Check whether the encryption key is configured.
 */
export function isEncryptionKeyConfigured(): boolean {
  return !!process.env.ENCRYPTION_KEY;
}
