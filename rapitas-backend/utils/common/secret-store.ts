import { decrypt, encrypt, maskApiKey } from './encryption';
import { createLogger } from '../../config/logger';

const log = createLogger('secret-store');

const SERVICE_NAME = process.env.RAPITAS_KEYCHAIN_SERVICE || 'rapitas';
const KEYCHAIN_PREFIX = 'keychain:';

type KeyringEntry = {
  getPassword: () => string | null;
  setPassword: (value: string) => void;
  deletePassword?: () => void;
};

function isDesktopKeychainPreferred(): boolean {
  return process.env.RAPITAS_DB_PROVIDER === 'sqlite' || process.env.TAURI_BUILD === 'true';
}

function tryCreateEntry(account: string): KeyringEntry | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@napi-rs/keyring') as typeof import('@napi-rs/keyring');
    const entry = new mod.Entry(SERVICE_NAME, account);
    return {
      getPassword: () => {
        try {
          return entry.getPassword();
        } catch {
          // intentionally ignore - return null on keyring failure
          return null;
        }
      },
      setPassword: (value: string) => entry.setPassword(value),
      deletePassword: () => {
        try {
          entry.deletePassword();
        } catch {
          // intentionally ignore - already absent or platform does not support delete
        }
      },
    };
  } catch {
    // intentionally ignore - keyring module may not be available
    return null;
  }
}

function providerAccount(provider: string): string {
  return `api-key:${provider}`;
}

function agentAccount(id: number): string {
  return `agent-api-key:${id}`;
}

function keychainRef(account: string): string {
  return `${KEYCHAIN_PREFIX}${account}`;
}

function accountFromRef(value: string): string | null {
  return value.startsWith(KEYCHAIN_PREFIX) ? value.slice(KEYCHAIN_PREFIX.length) : null;
}

export function isKeychainSecretRef(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.startsWith(KEYCHAIN_PREFIX);
}

export function saveProviderApiKey(provider: string, apiKey: string): string {
  return saveSecret(providerAccount(provider), apiKey);
}

export function saveAgentApiKey(id: number, apiKey: string): string {
  return saveSecret(agentAccount(id), apiKey);
}

export function saveSecret(account: string, secret: string): string {
  if (isDesktopKeychainPreferred()) {
    const entry = tryCreateEntry(account);
    if (entry) {
      try {
        entry.setPassword(secret);
        return keychainRef(account);
      } catch (error) {
        log.warn({ err: error }, `Failed to write ${account} to OS keychain; using encrypted DB`);
      }
    }
  }

  return encrypt(secret);
}

export function resolveStoredSecret(storedValue: string | null | undefined): string | null {
  if (!storedValue) return null;

  const account = accountFromRef(storedValue);
  if (account) {
    const entry = tryCreateEntry(account);
    if (!entry) return null;
    return entry.getPassword();
  }

  return decrypt(storedValue);
}

export function deleteStoredSecret(storedValue: string | null | undefined): void {
  const account = accountFromRef(storedValue ?? '');
  if (!account) return;

  const entry = tryCreateEntry(account);
  entry?.deletePassword?.();
}

export function maskStoredSecret(storedValue: string | null | undefined): string | null {
  const secret = resolveStoredSecret(storedValue);
  return secret ? maskApiKey(secret) : null;
}
