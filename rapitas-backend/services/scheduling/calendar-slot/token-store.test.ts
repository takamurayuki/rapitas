/**
 * token-store.test
 *
 * The calendar refresh token goes through CalendarTokenStore only: the memory
 * store round-trips, and the keychain store writes to the secret store and
 * never keeps the plaintext anywhere a DB row could pick it up.
 */
import { describe, it, expect, mock } from 'bun:test';

const saved = new Map<string, string>();
mock.module('../../../utils/common/secret-store', () => ({
  saveSecret: mock((account: string, secret: string) => {
    saved.set(account, secret);
    return `keychain:${account}`;
  }),
  resolveStoredSecret: mock((ref: string | null | undefined) => {
    if (!ref?.startsWith('keychain:')) return null;
    return saved.get(ref.slice('keychain:'.length)) ?? null;
  }),
  deleteStoredSecret: mock((ref: string | null | undefined) => {
    if (ref?.startsWith('keychain:')) saved.delete(ref.slice('keychain:'.length));
  }),
  isKeychainSecretRef: (v: string | null | undefined) =>
    typeof v === 'string' && v.startsWith('keychain:'),
  saveProviderApiKey: mock(() => ''),
  saveAgentApiKey: mock(() => ''),
  maskStoredSecret: mock(() => null),
}));

const {
  MemoryCalendarTokenStore,
  KeychainCalendarTokenStore,
  CALENDAR_TOKEN_ACCOUNT,
  calendarTokenAccount,
} = await import('./token-store');

describe('MemoryCalendarTokenStore', () => {
  it('round-trips and clears a token', () => {
    const store = new MemoryCalendarTokenStore();
    expect(store.get()).toBeNull();
    store.set('rt-1');
    expect(store.get()).toBe('rt-1');
    store.clear();
    expect(store.get()).toBeNull();
  });
});

describe('KeychainCalendarTokenStore', () => {
  it('persists via the OS keychain account and reads it back', () => {
    const store = new KeychainCalendarTokenStore();
    store.set('rt-2');
    expect(saved.get(CALENDAR_TOKEN_ACCOUNT)).toBe('rt-2');
    expect(store.get()).toBe('rt-2');
    expect(store.isPersistent()).toBe(true);
    store.clear();
    expect(store.get()).toBeNull();
  });
});

/**
 * One token per workspace.
 *
 * Found 2026-10-29: the account name was a single fixed string and
 * `getCalendarTokenStore()` a process singleton, so whichever account
 * connected its Google Calendar first supplied the busy blocks for EVERY
 * account on the install — a throwaway `verify` login read the owner's
 * calendar. Keeping the slots apart is what makes the connection personal.
 */
describe('per-workspace token slots', () => {
  it('gives two workspaces different keychain accounts', () => {
    expect(calendarTokenAccount(1)).not.toBe(calendarTokenAccount(2));
  });

  it('keeps one workspace from reading another’s token', () => {
    const ws1 = new KeychainCalendarTokenStore(1);
    const ws2 = new KeychainCalendarTokenStore(2);

    ws1.set('token-of-workspace-1');

    expect(ws1.get()).toBe('token-of-workspace-1');
    expect(ws2.get()).toBeNull();
  });

  it('does not disconnect another workspace when one clears', () => {
    const ws1 = new KeychainCalendarTokenStore(1);
    const ws2 = new KeychainCalendarTokenStore(2);
    ws1.set('t1');
    ws2.set('t2');

    ws2.clear();

    expect(ws2.get()).toBeNull();
    expect(ws1.get()).toBe('t1');
  });

  it('falls back to the install-wide slot when no workspace is known', () => {
    // Anonymous and agent-originated requests carry no session, so there is
    // no workspace to key on. They get the legacy slot, which nothing writes
    // any more — so they read null and report "not connected" rather than
    // picking up somebody's credential.
    expect(calendarTokenAccount(null)).toBe(CALENDAR_TOKEN_ACCOUNT);
    expect(calendarTokenAccount(1)).not.toBe(CALENDAR_TOKEN_ACCOUNT);
  });
});
