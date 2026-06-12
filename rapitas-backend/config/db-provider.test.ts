/**
 * db-provider.test.ts
 *
 * Unit tests for getDbProvider() and getInsensitiveMode().
 * Covers all env-var combinations defined in the plan's test strategy.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getDbProvider, getInsensitiveMode } from './db-provider';

describe('getDbProvider', () => {
  let savedProvider: string | undefined;
  let savedUrl: string | undefined;

  beforeEach(() => {
    savedProvider = process.env.RAPITAS_DB_PROVIDER;
    savedUrl = process.env.DATABASE_URL;
    delete process.env.RAPITAS_DB_PROVIDER;
    delete process.env.DATABASE_URL;
  });

  afterEach(() => {
    if (savedProvider === undefined) {
      delete process.env.RAPITAS_DB_PROVIDER;
    } else {
      process.env.RAPITAS_DB_PROVIDER = savedProvider;
    }
    if (savedUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = savedUrl;
    }
  });

  it('① both env vars unset → postgresql (production default)', () => {
    expect(getDbProvider()).toBe('postgresql');
  });

  it('② RAPITAS_DB_PROVIDER=sqlite → sqlite', () => {
    process.env.RAPITAS_DB_PROVIDER = 'sqlite';
    expect(getDbProvider()).toBe('sqlite');
  });

  it('③ DATABASE_URL=file:... → sqlite', () => {
    process.env.DATABASE_URL = 'file:./dev.db';
    expect(getDbProvider()).toBe('sqlite');
  });

  it('③ DATABASE_URL=file: (absolute path) → sqlite', () => {
    process.env.DATABASE_URL = 'file:/home/user/rapitas.db';
    expect(getDbProvider()).toBe('sqlite');
  });

  it('④ DATABASE_URL=postgresql://... → postgresql', () => {
    process.env.DATABASE_URL = 'postgresql://user:pass@localhost/rapitas';
    expect(getDbProvider()).toBe('postgresql');
  });

  it('④ DATABASE_URL=postgres://... (short form) → postgresql', () => {
    process.env.DATABASE_URL = 'postgres://user:pass@localhost/rapitas';
    expect(getDbProvider()).toBe('postgresql');
  });

  it('⑤ both env vars point to sqlite → sqlite', () => {
    process.env.RAPITAS_DB_PROVIDER = 'sqlite';
    process.env.DATABASE_URL = 'file:./dev.db';
    expect(getDbProvider()).toBe('sqlite');
  });

  it('⑥ RAPITAS_DB_PROVIDER=postgres + DATABASE_URL=file:... → postgresql (explicit env wins)', () => {
    process.env.RAPITAS_DB_PROVIDER = 'postgres';
    process.env.DATABASE_URL = 'file:./dev.db';
    expect(getDbProvider()).toBe('postgresql');
  });

  it('⑥ RAPITAS_DB_PROVIDER=postgresql (long form) + DATABASE_URL=file:... → postgresql', () => {
    process.env.RAPITAS_DB_PROVIDER = 'postgresql';
    process.env.DATABASE_URL = 'file:./dev.db';
    expect(getDbProvider()).toBe('postgresql');
  });

  it('RAPITAS_DB_PROVIDER case-insensitive → sqlite', () => {
    process.env.RAPITAS_DB_PROVIDER = 'SQLite';
    expect(getDbProvider()).toBe('sqlite');
  });
});

describe('getInsensitiveMode', () => {
  let savedProvider: string | undefined;
  let savedUrl: string | undefined;

  beforeEach(() => {
    savedProvider = process.env.RAPITAS_DB_PROVIDER;
    savedUrl = process.env.DATABASE_URL;
    delete process.env.RAPITAS_DB_PROVIDER;
    delete process.env.DATABASE_URL;
  });

  afterEach(() => {
    if (savedProvider === undefined) {
      delete process.env.RAPITAS_DB_PROVIDER;
    } else {
      process.env.RAPITAS_DB_PROVIDER = savedProvider;
    }
    if (savedUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = savedUrl;
    }
  });

  it('⑦ postgresql → { mode: "insensitive" }', () => {
    expect(getInsensitiveMode()).toEqual({ mode: 'insensitive' });
  });

  it('⑦ sqlite → {} (empty object)', () => {
    process.env.RAPITAS_DB_PROVIDER = 'sqlite';
    expect(getInsensitiveMode()).toEqual({});
  });
});
