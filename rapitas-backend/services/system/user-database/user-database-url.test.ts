/**
 * user-database-url tests (#1285)
 *
 * The connection string is a secret: it is validated before anything uses
 * it, and every place it is shown or logged gets the masked form.
 */
import { describe, test, expect } from 'bun:test';
import { validateDatabaseUrl, maskDatabaseUrl } from './user-database-url';

describe('validateDatabaseUrl', () => {
  test.each([
    'postgresql://user:pw@db.example.supabase.co:5432/postgres?sslmode=require',
    'postgres://user:pw@host/db',
  ])('accepts %s', (url) => {
    expect(validateDatabaseUrl(url)).toEqual({ ok: true, url });
  });

  test.each([
    ['file:./local.db', 'postgresql'],
    ['mysql://u:p@h/db', 'postgresql'],
    ['postgresql://', 'host'],
    ['postgresql://u:p@/db', 'host'],
    ['postgresql://u:p@host', 'database'],
    ['not a url', 'postgresql'],
    ['', 'postgresql'],
  ])('rejects %p', (url, word) => {
    const r = validateDatabaseUrl(url);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain(word);
  });

  test('trims surrounding whitespace before checking', () => {
    expect(validateDatabaseUrl('  postgres://u:p@h/db \n')).toEqual({
      ok: true,
      url: 'postgres://u:p@h/db',
    });
  });
});

describe('maskDatabaseUrl', () => {
  test('hides the password and keeps what identifies the database', () => {
    expect(
      maskDatabaseUrl('postgresql://alice:s3cr3t@db.example.co:5432/postgres?sslmode=require'),
    ).toBe('postgresql://alice:***@db.example.co:5432/postgres?sslmode=require');
  });
  test('a URL without a password is unchanged', () => {
    expect(maskDatabaseUrl('postgres://alice@h/db')).toBe('postgres://alice@h/db');
  });
  test('a username that looks like the encoded placeholder is left alone', () => {
    // The old string replace hit the FIRST "%2A%2A%2A" — the username here —
    // and left the password slot percent-encoded (CodeQL js/incomplete-sanitization).
    expect(maskDatabaseUrl('postgresql://%2A%2A%2A:s3cr3t@h:5432/db')).toBe(
      'postgresql://%2A%2A%2A:***@h:5432/db',
    );
  });
  test('an unparseable string is fully masked, never echoed', () => {
    expect(maskDatabaseUrl('postgres://user:pa ss@@')).toBe('***');
  });
});
