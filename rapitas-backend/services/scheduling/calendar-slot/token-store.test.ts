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

const { MemoryCalendarTokenStore, KeychainCalendarTokenStore, CALENDAR_TOKEN_ACCOUNT } =
  await import('./token-store');

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
