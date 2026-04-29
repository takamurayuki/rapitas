/**
 * Encryption Key Resolver
 *
 * Hybrid resolution chain so the master encryption key works across:
 * - Web / container deployments (env var)
 * - Tauri desktop (Tauri may inject the key via env at spawn time)
 * - Bun standalone on a desktop OS (OS keychain via @napi-rs/keyring)
 * - Headless / dev where keychain is unavailable (file under ~/.rapitas/)
 *
 * Resolution priority (first hit wins):
 *   1. process.env.ENCRYPTION_KEY                   — explicit override
 *   2. OS keychain  (service=rapitas, account=encryption-key)
 *   3. ~/.rapitas/encryption.key                    — file fallback
 *   4. Legacy file rapitas-backend/utils/.encryption-key (auto-migrated)
 *   5. Generate new key → write to (2) if available, else (3)
 *
 * The resolver is designed to be safe to call multiple times; it caches the
 * resolved key and the source it came from for diagnostics.
 */

import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';

// NOTE: RAPITAS_KEYCHAIN_SERVICE allows tests (and exotic deployments) to
// route the keychain entry to a different service so they cannot collide
// with the real "rapitas" entry on a developer's machine.
const SERVICE_NAME = process.env.RAPITAS_KEYCHAIN_SERVICE || 'rapitas';
const ACCOUNT_NAME = 'encryption-key';
const KEY_LENGTH_HEX = 64;

export type KeySource = 'env' | 'keychain' | 'file' | 'legacy-file' | 'generated';

interface ResolvedKey {
  value: string;
  source: KeySource;
}

let cached: ResolvedKey | null = null;

/**
 * Lazily-loaded keyring entry. Returns null when the platform binding cannot
 * be loaded (CI, headless Linux without libsecret, unsupported arch).
 */
function tryLoadKeyring(): {
  getPassword: () => string | null;
  setPassword: (v: string) => void;
} | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@napi-rs/keyring') as typeof import('@napi-rs/keyring');
    const entry = new mod.Entry(SERVICE_NAME, ACCOUNT_NAME);
    return {
      getPassword: () => {
        try {
          return entry.getPassword();
        } catch {
          return null;
        }
      },
      setPassword: (v: string) => entry.setPassword(v),
    };
  } catch {
    return null;
  }
}

function userKeyFilePath(): string {
  return path.join(os.homedir(), '.rapitas', 'encryption.key');
}

function legacyKeyFilePath(): string {
  // Original location (rapitas-backend/utils/.encryption-key)
  return path.join(__dirname, '..', '.encryption-key');
}

function readKeyFromFile(p: string): string | null {
  try {
    if (!fs.existsSync(p)) return null;
    const v = fs.readFileSync(p, 'utf8').trim();
    return v.length === KEY_LENGTH_HEX ? v : null;
  } catch {
    return null;
  }
}

function writeKeyToFile(p: string, value: string): void {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, value, { mode: 0o600 });
}

/**
 * Resolve (and cache) the encryption key.
 *
 * @returns The 64-hex-char encryption key string.
 */
export function resolveEncryptionKey(): string {
  if (cached) return cached.value;

  // 1. Environment variable
  if (process.env.ENCRYPTION_KEY && process.env.ENCRYPTION_KEY.length === KEY_LENGTH_HEX) {
    cached = { value: process.env.ENCRYPTION_KEY, source: 'env' };
    return cached.value;
  }

  const keyring = tryLoadKeyring();

  // 2. OS keychain
  if (keyring) {
    const v = keyring.getPassword();
    if (v && v.length === KEY_LENGTH_HEX) {
      cached = { value: v, source: 'keychain' };
      return cached.value;
    }
  }

  // 3. User file fallback
  const userPath = userKeyFilePath();
  const fileKey = readKeyFromFile(userPath);
  if (fileKey) {
    // Best-effort upgrade into keychain so subsequent runs use the more
    // secure store automatically.
    if (keyring) {
      try {
        keyring.setPassword(fileKey);
        console.log('[encryption] Migrated key from user file into OS keychain');
      } catch {
        /* keep file as-is on failure */
      }
    }
    cached = { value: fileKey, source: 'file' };
    return cached.value;
  }

  // 4. Legacy file inside the repo (one-shot migration target)
  const legacyKey = readKeyFromFile(legacyKeyFilePath());
  if (legacyKey) {
    if (keyring) {
      try {
        keyring.setPassword(legacyKey);
        console.log('[encryption] Migrated legacy key into OS keychain');
      } catch {
        try {
          writeKeyToFile(userPath, legacyKey);
          console.log('[encryption] Migrated legacy key to user file');
        } catch {
          /* fall through */
        }
      }
    } else {
      try {
        writeKeyToFile(userPath, legacyKey);
        console.log('[encryption] Migrated legacy key to user file');
      } catch {
        /* fall through */
      }
    }
    cached = { value: legacyKey, source: 'legacy-file' };
    return cached.value;
  }

  // 5. Generate
  const generated = crypto.randomBytes(32).toString('hex');
  if (keyring) {
    try {
      keyring.setPassword(generated);
      console.log('[encryption] Generated new key and stored in OS keychain');
    } catch {
      try {
        writeKeyToFile(userPath, generated);
        console.warn(`[encryption] Keychain write failed; saved key to ${userPath}`);
      } catch (err) {
        console.error('[encryption] Failed to persist generated key:', err);
      }
    }
  } else {
    try {
      writeKeyToFile(userPath, generated);
      console.log(`[encryption] Generated new key at ${userPath}`);
    } catch (err) {
      console.error('[encryption] Failed to persist generated key:', err);
    }
  }
  cached = { value: generated, source: 'generated' };
  return cached.value;
}

/** Diagnostic accessor — returns where the cached key was loaded from. */
export function getKeySource(): KeySource | null {
  return cached?.source ?? null;
}

/** For tests only — wipes the cached key. Does NOT touch keychain or files. */
export function __resetKeyCache(): void {
  cached = null;
}
