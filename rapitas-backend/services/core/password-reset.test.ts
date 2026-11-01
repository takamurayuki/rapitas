/**
 * password-reset unit
 *
 * Why this exists: the install's owner could not sign in. Their last session
 * expired 2026-06-04 and the password was lost, and until tenancy landed that
 * did not matter — the app served everything to a guest. Now signing in is
 * what decides whose data you see, so there has to be a way back in.
 *
 * The behaviours worth holding still are the ones that make a reset safe to
 * run on a live install: the plaintext never reaches the database, a bad
 * request writes nothing at all, and the reset actually ENDS the sessions that
 * existed before it — a reset that leaves them alive has not taken anything
 * away from whoever held them.
 */
import { describe, it, expect } from 'bun:test';
import {
  resetUserPassword,
  generatePassword,
  MIN_PASSWORD_LENGTH,
  type PasswordResetDb,
} from './password-reset';

interface Recorder {
  db: PasswordResetDb;
  calls: string[];
  updated: { id: number; passwordHash: string } | null;
}

function fakeDb(user: { id: number; username: string } | null): Recorder {
  const rec: Recorder = { db: null as unknown as PasswordResetDb, calls: [], updated: null };
  rec.db = {
    user: {
      findFirst: async () => {
        rec.calls.push('user.findFirst');
        return user;
      },
      update: async ({ where, data }) => {
        rec.calls.push('user.update');
        rec.updated = { id: where.id, passwordHash: data.passwordHash };
        return {};
      },
    },
    userSession: {
      deleteMany: async ({ where }) => {
        rec.calls.push(`userSession.deleteMany(${where.userId})`);
        return { count: 3 };
      },
    },
  };
  return rec;
}

/** A stand-in hash, so the tests do not pay for bcrypt's cost factor. */
const fakeHash = async (pw: string): Promise<string> => `hashed:${pw}`;

describe('resetUserPassword', () => {
  it('stores a hash, never the password itself', async () => {
    const rec = fakeDb({ id: 1, username: 'yuki' });

    await resetUserPassword({
      identifier: 'yuki',
      password: 'correct horse battery',
      db: rec.db,
      hash: fakeHash,
    });

    expect(rec.updated?.passwordHash).toBe('hashed:correct horse battery');
    expect(rec.updated?.passwordHash).not.toBe('correct horse battery');
  });

  it('ends every session that existed before the reset', async () => {
    // Otherwise the reset changes the password and changes nothing else: an
    // old cookie keeps working for its full 24h.
    const rec = fakeDb({ id: 7, username: 'yuki' });

    const result = await resetUserPassword({
      identifier: 'yuki',
      password: 'a-long-enough-one',
      db: rec.db,
      hash: fakeHash,
    });

    expect(rec.calls).toContain('userSession.deleteMany(7)');
    expect(result.revokedSessions).toBe(3);
  });

  it('changes the password before revoking, so no window re-mints one', async () => {
    const rec = fakeDb({ id: 7, username: 'yuki' });

    await resetUserPassword({
      identifier: 'yuki',
      password: 'a-long-enough-one',
      db: rec.db,
      hash: fakeHash,
    });

    expect(rec.calls.indexOf('user.update')).toBeLessThan(
      rec.calls.indexOf('userSession.deleteMany(7)'),
    );
  });

  it('reports who it changed', async () => {
    const rec = fakeDb({ id: 42, username: 'yuki' });

    const result = await resetUserPassword({
      identifier: 'takamura@example.test',
      password: 'a-long-enough-one',
      db: rec.db,
      hash: fakeHash,
    });

    expect(result).toMatchObject({ userId: 42, username: 'yuki' });
  });
});

describe('what it refuses, without writing anything', () => {
  it('refuses an unknown user', async () => {
    const rec = fakeDb(null);

    await expect(
      resetUserPassword({ identifier: 'nobody', password: 'a-long-enough-one', db: rec.db }),
    ).rejects.toThrow('no account');

    expect(rec.calls).toEqual(['user.findFirst']);
  });

  it.each([[''], ['short'], ['1234567']])('refuses the too-short password %p', async (pw) => {
    // Same floor as registration: a reset must not be a way around it.
    const rec = fakeDb({ id: 1, username: 'yuki' });

    await expect(
      resetUserPassword({ identifier: 'yuki', password: pw, db: rec.db }),
    ).rejects.toThrow(`at least ${MIN_PASSWORD_LENGTH}`);

    expect(rec.calls).toEqual([]);
    expect(rec.updated).toBeNull();
  });

  it('refuses an empty identifier before looking anything up', async () => {
    const rec = fakeDb({ id: 1, username: 'yuki' });

    await expect(
      resetUserPassword({ identifier: '   ', password: 'a-long-enough-one', db: rec.db }),
    ).rejects.toThrow('username or email');

    expect(rec.calls).toEqual([]);
  });
});

describe('generatePassword', () => {
  it('clears the length floor it has to satisfy', () => {
    expect(generatePassword().length).toBeGreaterThanOrEqual(MIN_PASSWORD_LENGTH);
  });

  it('does not repeat itself', () => {
    const seen = new Set(Array.from({ length: 50 }, () => generatePassword()));
    expect(seen.size).toBe(50);
  });

  it('stays copy-pasteable (url-safe characters only)', () => {
    // It gets read off a terminal and typed into a login form; quoting or
    // shell-escaping characters would make that worse.
    for (let i = 0; i < 20; i++) expect(generatePassword()).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
