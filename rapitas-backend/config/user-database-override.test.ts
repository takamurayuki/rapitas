/**
 * user-database-override tests (#1285)
 *
 * The boot-time switch to a user's own database. It switches only to a
 * database that was explicitly initialized, and can always be turned off,
 * so a bad URL can never strand the app with no way back to local data.
 */
import { describe, test, expect } from 'bun:test';
import { applyUserDatabaseOverride } from './user-database-override';

const URL_A = 'postgresql://alice:pw@db.example.co:5432/postgres';
const env = (over: Record<string, string> = {}) =>
  ({
    DATABASE_URL: 'file:/data/rapitas.db',
    RAPITAS_DB_PROVIDER: 'sqlite',
    ...over,
  }) as NodeJS.ProcessEnv;

describe('applyUserDatabaseOverride', () => {
  test('switches to an initialized user database', () => {
    const e = env();
    const r = applyUserDatabaseOverride(e, () => ({
      url: URL_A,
      initializedAt: '2026-11-03T00:00:00Z',
    }));
    expect(r).toEqual({
      applied: true,
      masked: 'postgresql://alice:***@db.example.co:5432/postgres',
    });
    expect(e.DATABASE_URL).toBe(URL_A);
    expect(e.RAPITAS_DB_PROVIDER).toBe('postgresql');
  });

  test('a saved but never-initialized database is not switched to', () => {
    const e = env();
    const r = applyUserDatabaseOverride(e, () => ({ url: URL_A, initializedAt: null }));
    expect(r).toEqual({ applied: false, reason: 'not_initialized' });
    expect(e.DATABASE_URL).toBe('file:/data/rapitas.db');
  });

  test('nothing configured leaves the local database', () => {
    const e = env();
    expect(applyUserDatabaseOverride(e, () => null)).toEqual({
      applied: false,
      reason: 'not_configured',
    });
    expect(e.RAPITAS_DB_PROVIDER).toBe('sqlite');
  });

  test('RAPITAS_USER_DATABASE=off is the way back, whatever is stored', () => {
    const e = env({ RAPITAS_USER_DATABASE: 'off' });
    const r = applyUserDatabaseOverride(e, () => ({
      url: URL_A,
      initializedAt: '2026-11-03T00:00:00Z',
    }));
    expect(r).toEqual({ applied: false, reason: 'disabled' });
    expect(e.DATABASE_URL).toBe('file:/data/rapitas.db');
  });

  test('a store that throws leaves the local database rather than failing boot', () => {
    const e = env();
    const r = applyUserDatabaseOverride(e, () => {
      throw new Error('keychain locked');
    });
    expect(r).toEqual({ applied: false, reason: 'unreadable' });
    expect(e.DATABASE_URL).toBe('file:/data/rapitas.db');
  });
});
