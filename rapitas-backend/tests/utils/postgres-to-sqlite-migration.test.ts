import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import {
  insertRows,
  normalizeSqliteValue,
  parseCreateTableOrder,
  sqlitePathFromDatabaseUrl,
} from '../../scripts/migrate-postgres-to-sqlite';

let database: Database | null = null;

afterEach(() => {
  database?.close();
  database = null;
});

describe('postgres to sqlite migration helpers', () => {
  test('parses create table order from generated SQL', () => {
    const sql = `
      CREATE TABLE "Parent" ("id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT);
      CREATE INDEX "Parent_id_idx" ON "Parent"("id");
      CREATE TABLE "Child" ("id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT);
    `;

    expect(parseCreateTableOrder(sql)).toEqual(['Parent', 'Child']);
  });

  test('resolves file database URLs to absolute paths', () => {
    const path = sqlitePathFromDatabaseUrl('file:./tmp/rapitas-test.db');
    expect(path.endsWith('tmp\\rapitas-test.db') || path.endsWith('tmp/rapitas-test.db')).toBe(
      true,
    );
  });

  test('rejects non-file SQLite URLs', () => {
    expect(() => sqlitePathFromDatabaseUrl('postgresql://localhost/rapitas')).toThrow(
      'SQLite database URL must start with file:',
    );
  });

  test('normalizes values before SQLite insertion', () => {
    const date = new Date('2026-04-29T12:34:56.000Z');

    expect(normalizeSqliteValue(true)).toBe(1);
    expect(normalizeSqliteValue(false)).toBe(0);
    expect(normalizeSqliteValue(10n)).toBe(10);
    expect(normalizeSqliteValue(date)).toBe('2026-04-29T12:34:56.000Z');
    expect(normalizeSqliteValue({ enabled: true })).toBe('{"enabled":true}');
    expect(normalizeSqliteValue(undefined)).toBeNull();
  });

  test('inserts filtered rows into SQLite without changing column order', () => {
    database = new Database(':memory:');
    database.exec(`
      CREATE TABLE "Sample" (
        "id" INTEGER NOT NULL PRIMARY KEY,
        "name" TEXT NOT NULL,
        "enabled" BOOLEAN NOT NULL,
        "metadata" TEXT
      );
    `);

    const written = insertRows(
      database,
      'Sample',
      ['id', 'name', 'enabled', 'metadata'],
      [
        { id: 1, name: 'first', enabled: true, metadata: { source: 'postgres' } },
        { id: 2, name: 'second', enabled: false, metadata: null },
      ],
    );

    expect(written).toBe(2);
    expect(database.query('SELECT * FROM "Sample" ORDER BY "id"').all()).toEqual([
      { id: 1, name: 'first', enabled: 1, metadata: '{"source":"postgres"}' },
      { id: 2, name: 'second', enabled: 0, metadata: null },
    ]);
  });
});
