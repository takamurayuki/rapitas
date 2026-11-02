/**
 * token-store
 *
 * Storage abstraction for the Google Calendar refresh token (task 1174). The
 * production implementation uses the OS keychain through secret-store; there
 * is deliberately no DB column for the token (AGENTS.md: credentials live in
 * the OS keychain). Not responsible for the OAuth exchange itself.
 *
 * One slot per workspace. Found 2026-10-29: the account name was a single
 * fixed string, so whichever account connected its Google Calendar first
 * supplied the busy blocks for EVERY account on the install — a throwaway
 * `verify` login read the owner's calendar.
 */
import { createLogger } from '../../../config/logger';
import {
  deleteStoredSecret,
  isKeychainSecretRef,
  resolveStoredSecret,
  saveSecret,
} from '../../../utils/common/secret-store';

const log = createLogger('calendar-token-store');

/**
 * Keychain account name used when no workspace is known.
 *
 * Also the name this feature used before the token became per-workspace;
 * nothing writes it any more, so a caller without a workspace reads null and
 * reports "not connected" rather than picking up somebody's credential.
 */
export const CALENDAR_TOKEN_ACCOUNT = 'google-calendar:refresh-token';

/**
 * The keychain account holding one workspace's calendar refresh token.
 *
 * @param workspaceId - Owning workspace, or null when unknown / 所有ワークスペース（不明なら null）
 * @returns Keychain account name / キーチェーンのアカウント名
 */
export function calendarTokenAccount(workspaceId: number | null): string {
  return workspaceId === null
    ? CALENDAR_TOKEN_ACCOUNT
    : `${CALENDAR_TOKEN_ACCOUNT}:w${workspaceId}`;
}

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
  private readonly account: string;
  private readonly ref: string;
  private fallbackCipher: string | null = null;
  private persistent = false;

  /**
   * @param workspaceId - Whose calendar this store holds / どのワークスペースの資格情報か
   */
  constructor(workspaceId: number | null = null) {
    this.account = calendarTokenAccount(workspaceId);
    this.ref = `keychain:${this.account}`;
  }

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
    const stored = saveSecret(this.account, token);
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
