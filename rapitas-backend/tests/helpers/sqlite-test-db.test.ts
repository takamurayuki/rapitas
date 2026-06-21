/**
 * sqlite-test-db.test.ts
 *
 * `tests/helpers/sqlite-test-db.ts` のユニット / 統合テスト。
 * plan.md のテスト計画に準拠した 18 ケースを網羅する。
 */
import { describe, test, expect } from 'bun:test';
import { existsSync } from 'node:fs';
import { withMemoryDb, withTempFileDb, withTempDir, registerCleanup } from './sqlite-test-db';

// ---------------------------------------------------------------------------
// withMemoryDb
// ---------------------------------------------------------------------------

describe('withMemoryDb', () => {
  test('DDL + INSERT + SELECT が通る', () => {
    const db = withMemoryDb({
      initSql: `CREATE TABLE "Item" ("id" INTEGER PRIMARY KEY, "name" TEXT NOT NULL)`,
    });
    db.exec(`INSERT INTO "Item" ("name") VALUES ('hello')`);
    const row = db.query('SELECT name FROM "Item" WHERE id = 1').get() as { name: string };
    expect(row.name).toBe('hello');
  });

  test('initSql が文字列配列に対応している', () => {
    const db = withMemoryDb({
      initSql: [
        `CREATE TABLE "A" ("id" INTEGER PRIMARY KEY, "v" TEXT)`,
        `CREATE TABLE "B" ("id" INTEGER PRIMARY KEY, "a_id" INTEGER REFERENCES "A"("id"))`,
        `INSERT INTO "A" VALUES (1, 'x')`,
        `INSERT INTO "B" VALUES (1, 1)`,
      ],
    });
    const count = (db.query('SELECT count(*) as c FROM "B"').get() as { c: number }).c;
    expect(count).toBe(1);
  });

  test('opts なしでも動作する（空 DB）', () => {
    const db = withMemoryDb();
    db.exec(`CREATE TABLE "T" ("x" INTEGER)`);
    db.exec(`INSERT INTO "T" VALUES (42)`);
    const row = db.query('SELECT x FROM "T"').get() as { x: number };
    expect(row.x).toBe(42);
  });

  test('二重 close しても例外が出ない', () => {
    const db = withMemoryDb();
    db.exec(`CREATE TABLE "T" ("x" INTEGER)`);
    // 手動 close 後、registerCleanup で登録した afterEach close が走っても安全
    expect(() => db.close()).not.toThrow();
    expect(() => db.close()).not.toThrow();
  });

  test('不正 DDL の場合は例外が伝播する（initSql 経由）', () => {
    expect(() => withMemoryDb({ initSql: 'NOT VALID SQL !!!' })).toThrow();
  });

  test('不正 DDL の場合は例外が伝播する（直接 exec）', () => {
    const db = withMemoryDb();
    expect(() => db.exec('INVALID SQL')).toThrow();
  });
});

// ---------------------------------------------------------------------------
// withTempFileDb
// ---------------------------------------------------------------------------

describe('withTempFileDb', () => {
  test('ファイルが生成される', () => {
    const { path } = withTempFileDb();
    expect(existsSync(path)).toBe(true);
  });

  test('カスタム filename が反映される', () => {
    const { path } = withTempFileDb({ filename: 'custom.db' });
    expect(path.endsWith('custom.db')).toBe(true);
  });

  test('DDL + INSERT + SELECT が通る', () => {
    const { db } = withTempFileDb({
      initSql: `CREATE TABLE "Item" ("id" INTEGER PRIMARY KEY, "name" TEXT NOT NULL)`,
    });
    db.exec(`INSERT INTO "Item" ("name") VALUES ('world')`);
    const row = db.query('SELECT name FROM "Item"').get() as { name: string };
    expect(row.name).toBe('world');
  });

  test('二重 close しても例外が出ない', () => {
    const { db } = withTempFileDb();
    expect(() => db.close()).not.toThrow();
    expect(() => db.close()).not.toThrow();
  });

  test('initSql 配列で複数 DDL が順番に適用される', () => {
    const { db } = withTempFileDb({
      initSql: [
        `CREATE TABLE "X" ("id" INTEGER PRIMARY KEY, "val" TEXT)`,
        `INSERT INTO "X" VALUES (1, 'first')`,
        `INSERT INTO "X" VALUES (2, 'second')`,
      ],
    });
    const rows = db.query('SELECT val FROM "X" ORDER BY id').all() as Array<{ val: string }>;
    expect(rows).toHaveLength(2);
    expect(rows[0].val).toBe('first');
    expect(rows[1].val).toBe('second');
  });
});

// ---------------------------------------------------------------------------
// withTempDir
// ---------------------------------------------------------------------------

describe('withTempDir', () => {
  test('ディレクトリが生成される', () => {
    const dir = withTempDir();
    expect(existsSync(dir)).toBe(true);
  });

  test('プレフィックスが反映される', () => {
    const dir = withTempDir('my-prefix-');
    expect(dir).toMatch(/my-prefix-/);
  });

  test('デフォルトプレフィックスは rapitas-test- を含む', () => {
    const dir = withTempDir();
    expect(dir).toMatch(/rapitas-test-/);
  });
});

// ---------------------------------------------------------------------------
// registerCleanup
// ---------------------------------------------------------------------------

describe('registerCleanup', () => {
  test('scope="each" で登録した fn は afterEach 相当（テスト本体実行中は未実行）', () => {
    const calls: string[] = [];
    // afterEach に登録 → テスト本体では calls はまだ空
    registerCleanup(() => {
      calls.push('cleaned');
    }, 'each');
    expect(calls).toHaveLength(0);
  });

  test('scope="all" で登録した fn は afterAll 相当（テスト本体実行中は未実行）', () => {
    const calls: string[] = [];
    registerCleanup(() => {
      calls.push('all-cleaned');
    }, 'all');
    expect(calls).toHaveLength(0);
  });

  test('scope を省略すると "each" と同じ動作（テスト本体では未実行）', () => {
    const calls: string[] = [];
    registerCleanup(() => calls.push('default'));
    expect(calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 統合テスト: スキーマ → INSERT → JOIN 集計 → close の一連フロー
// ---------------------------------------------------------------------------

describe('統合テスト: スキーマ → 複数 INSERT → 集計 SELECT → close', () => {
  test('FK + JOIN + GROUP BY 集計が正しく動く', () => {
    const db = withMemoryDb({
      initSql: [
        `CREATE TABLE "Author" ("id" INTEGER PRIMARY KEY, "name" TEXT NOT NULL)`,
        `CREATE TABLE "Post" (
          "id" INTEGER PRIMARY KEY,
          "authorId" INTEGER NOT NULL REFERENCES "Author"("id"),
          "title" TEXT NOT NULL
        )`,
        `INSERT INTO "Author" VALUES (1, 'Alice')`,
        `INSERT INTO "Author" VALUES (2, 'Bob')`,
        `INSERT INTO "Post" VALUES (1, 1, 'Post A1')`,
        `INSERT INTO "Post" VALUES (2, 1, 'Post A2')`,
        `INSERT INTO "Post" VALUES (3, 2, 'Post B1')`,
      ],
    });

    const rows = db
      .query(
        `SELECT a.name, count(p.id) as post_count
         FROM "Author" a
         LEFT JOIN "Post" p ON p.authorId = a.id
         GROUP BY a.id
         ORDER BY a.name`,
      )
      .all() as Array<{ name: string; post_count: number }>;

    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ name: 'Alice', post_count: 2 });
    expect(rows[1]).toEqual({ name: 'Bob', post_count: 1 });
  });

  test('withTempFileDb でスキーマ → INSERT → SELECT → close の一連フロー', () => {
    const { db, path } = withTempFileDb({
      initSql: [
        `CREATE TABLE "Tag" ("id" INTEGER PRIMARY KEY, "name" TEXT UNIQUE NOT NULL)`,
        `INSERT INTO "Tag" VALUES (1, 'alpha')`,
        `INSERT INTO "Tag" VALUES (2, 'beta')`,
      ],
    });

    expect(existsSync(path)).toBe(true);

    const names = db
      .query('SELECT name FROM "Tag" ORDER BY id')
      .all()
      .map((r) => (r as { name: string }).name);
    expect(names).toEqual(['alpha', 'beta']);
  });
});
