/**
 * Encryption Utility
 *
 * Encrypts and decrypts sensitive information such as API keys.
 */

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

/**
 * Get or generate the encryption key.
 *
 * Priority:
 * 1. Environment variable ENCRYPTION_KEY (if set)
 * 2. .encryption-key file in the backend root
 * 3. Auto-generate and save to .encryption-key file
 */
function getOrCreateEncryptionKey(): string {
  // 1. Check environment variable first
  if (process.env.ENCRYPTION_KEY) {
    return process.env.ENCRYPTION_KEY;
  }

  // 2. Check for .encryption-key file
  const keyFilePath = path.join(__dirname, '..', '.encryption-key');

  if (fs.existsSync(keyFilePath)) {
    const key = fs.readFileSync(keyFilePath, 'utf8').trim();
    if (key && key.length === 64) {
      return key;
    }
  }

  // 3. Generate new key and save to file
  const newKey = crypto.randomBytes(32).toString('hex');

  try {
    fs.writeFileSync(keyFilePath, newKey, { mode: 0o600 }); // Restrictive permissions
    console.log(`[encryption] Generated new encryption key and saved to ${keyFilePath}`);
  } catch (err) {
    console.error('[encryption] Failed to save encryption key to file:', err);
    // Continue with the generated key even if file save fails
  }

  return newKey;
}

const ENCRYPTION_KEY = getOrCreateEncryptionKey();
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
