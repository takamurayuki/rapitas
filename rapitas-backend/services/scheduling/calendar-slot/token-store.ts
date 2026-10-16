/**
 * token-store
 *
 * Storage abstraction for the Google Calendar refresh token (task 1174). The
 * production implementation uses the OS keychain through secret-store; there
 * is deliberately no DB column for the token (AGENTS.md: credentials live in
 * the OS keychain). Not responsible for the OAuth exchange itself.
 */
import { createLogger } from '../../../config/logger';
import {
  deleteStoredSecret,
  isKeychainSecretRef,
  resolveStoredSecret,
  saveSecret,
} from '../../../utils/common/secret-store';

const log = createLogger('calendar-token-store');

/** Keychain account name of the calendar refresh token. */
export const CALENDAR_TOKEN_ACCOUNT = 'google-calendar:refresh-token';

/** Where the calendar refresh token is kept. */
export interface CalendarTokenStore {
  /** @returns The refresh token, or null when not connected. / 未接続なら null */
  get(): string | null;
  /** @param token - Refresh token to store / 保存するトークン */
  set(token: string): void;
  clear(): void;
}

/** Process-local store — used by tests and as the fallback when no keychain exists. */
export class MemoryCalendarTokenStore implements CalendarTokenStore {
  private token: string | null = null;

  get(): string | null {
    return this.token;
  }

  set(token: string): void {
    this.token = token;
  }

  clear(): void {
    this.token = null;
  }
}

/**
 * OS keychain store. When the keychain is unavailable, secret-store returns
 * ciphertext instead of a keychain ref; that value is kept in memory only
 * (never written to the DB), so the connection simply does not survive a
 * restart on such hosts.
 */
export class KeychainCalendarTokenStore implements CalendarTokenStore {
  private readonly ref = `keychain:${CALENDAR_TOKEN_ACCOUNT}`;
  private fallbackCipher: string | null = null;
  private persistent = false;

  get(): string | null {
    if (this.fallbackCipher) return resolveStoredSecret(this.fallbackCipher);
    try {
      return resolveStoredSecret(this.ref);
    } catch (err) {
      log.warn({ err }, '[calendar-token-store] keychain read failed');
      return null;
    }
  }

  set(token: string): void {
    const stored = saveSecret(CALENDAR_TOKEN_ACCOUNT, token);
    this.persistent = isKeychainSecretRef(stored);
    this.fallbackCipher = this.persistent ? null : stored;
    if (!this.persistent) {
      log.warn(
        '[calendar-token-store] OS keychain unavailable — calendar token kept in memory only',
      );
    }
  }

  clear(): void {
    this.fallbackCipher = null;
    this.persistent = false;
    deleteStoredSecret(this.ref);
  }

  /** @returns Whether the last set() reached the OS keychain. / keychain に保存できたか */
  isPersistent(): boolean {
    return this.persistent;
  }
}
