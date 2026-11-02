/**
 * user-database-store tests (#1285)
 *
 * Where the user's connection string lives: a secret reference in a small
 * JSON file under the data dir — outside the database it selects, because it
 * is read before any database is opened. The URL itself never lands in the
 * file in clear text.
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createUserDatabaseStore } from './user-database-store';

let dir: string;
const vault = new Map<string, string>();
const secrets = {
  save: (account: string, secret: string) => {
    vault.set(account, secret);
    return `keychain:${account}`;
  },
  resolve: (ref: string | null | undefined) =>
    ref ? (vault.get(ref.replace('keychain:', '')) ?? null) : null,
  remove: (ref: string | null | undefined) => {
    if (ref) vault.delete(ref.replace('keychain:', ''));
  },
};
const URL_A = 'postgresql://alice:pw@db.example.co:5432/postgres';

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'userdb-'));
  vault.clear();
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('createUserDatabaseStore', () => {
  test('nothing configured reads as null', () => {
    expect(createUserDatabaseStore(dir, secrets).read()).toBeNull();
  });

  test('saving keeps a secret reference, never the URL, in the file', () => {
    const store = createUserDatabaseStore(dir, secrets);
    store.save(URL_A);
    const text = readFileSync(join(dir, 'user-database.json'), 'utf8');
    expect(text).not.toContain('alice:pw');
    expect(store.read()).toEqual({ url: URL_A, initializedAt: null });
  });

  test('marking initialized is remembered; saving a URL again resets it', () => {
    const store = createUserDatabaseStore(dir, secrets);
    store.save(URL_A);
    store.markInitialized(new Date('2026-11-03T00:00:00Z'));
    expect(store.read()?.initializedAt).toBe('2026-11-03T00:00:00.000Z');
    store.save('postgresql://bob:pw@other/db');
    expect(store.read()?.initializedAt).toBeNull();
  });

  test('clearing removes the file and the secret', () => {
    const store = createUserDatabaseStore(dir, secrets);
    store.save(URL_A);
    store.clear();
    expect(existsSync(join(dir, 'user-database.json'))).toBe(false);
    expect(vault.size).toBe(0);
    expect(store.read()).toBeNull();
  });

  test('a secret that can no longer be resolved reads as null, not a half record', () => {
    const store = createUserDatabaseStore(dir, secrets);
    store.save(URL_A);
    vault.clear();
    expect(store.read()).toBeNull();
  });
});
