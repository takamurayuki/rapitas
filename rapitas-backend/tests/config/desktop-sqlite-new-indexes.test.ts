/**
 * desktop-sqlite-new-indexes.test.ts
 *
 * Verifies the four task-1560 indexes: present in the generated init SQL,
 * created on an existing DB at startup (idempotently), kept by the stale-index
 * cleanup, and actually chosen by the planner for the hot queries.
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { copyFileSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { SQLITE_INIT_SQL } from '../../src/generated/sqlite-init-sql';
import { ensureDesktopSqliteDatabase, dropStaleIndexes } from '../../config/desktop-sqlite';
import { toIdempotentIndexSql } from '../../config/desktop-sqlite-indexes';
import { ensureDesktopSqliteDatabase as ensureBeforeTask1560 } from './fixtures/task1560/desktop-sqlite';
import { SQLITE_INIT_SQL as BEFORE_TASK1560_SQL } from './fixtures/task1560/generated/sqlite-init-sql';

/** Removes a temp dir; Windows may hold the SQLite handle briefly, so retry and never fail the test. */
function cleanup(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    // leftover temp dir is harmless
  }
}

const NEW_INDEXES = [
  'AgentExecution_sessionId_idx',
  'AgentExecution_completedAt_idx',
  'AgentSession_configId_idx',
  'TimelineEvent_eventType_createdAt_idx',
];

function indexNames(db: Database): Set<string> {
  return new Set(
    (
      db.query("SELECT name FROM sqlite_master WHERE type='index'").all() as Array<{
        name: string;
      }>
    ).map((r) => r.name),
  );
}

describe('generated init SQL', () => {
  test.each(NEW_INDEXES)('declares %s', (name) => {
    expect(SQLITE_INIT_SQL).toMatch(new RegExp(`CREATE INDEX "${name}" ON`));
  });
});

describe('toIdempotentIndexSql', () => {
  test('adds IF NOT EXISTS to a Prisma index statement', () => {
    expect(toIdempotentIndexSql('CREATE INDEX "A_b_idx" ON "A"("b")')).toBe(
      'CREATE INDEX IF NOT EXISTS "A_b_idx" ON "A"("b")',
    );
    expect(toIdempotentIndexSql('CREATE UNIQUE INDEX "A_b_key" ON "A"("b")')).toBe(
      'CREATE UNIQUE INDEX IF NOT EXISTS "A_b_key" ON "A"("b")',
    );
  });
  test('leaves an already idempotent statement unchanged', () => {
    const s = 'CREATE INDEX IF NOT EXISTS "A_b_idx" ON "A"("b")';
    expect(toIdempotentIndexSql(s)).toBe(s);
  });
});

describe('startup self-heal on an existing DB', () => {
  let dir: string;
  let dbPath: string;
  const prevUrl = process.env.DATABASE_URL;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'idx-test-'));
    dbPath = join(dir, 'test.db');
    process.env.DATABASE_URL = `file:${dbPath}`;
  });
  afterEach(() => {
    if (prevUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = prevUrl;
    cleanup(dir);
  });

  test('creates the four indexes on a DB that lacks them, and is idempotent', async () => {
    await ensureDesktopSqliteDatabase();
    let db = new Database(dbPath);
    for (const n of NEW_INDEXES) db.exec(`DROP INDEX "${n}"`);
    const before = indexNames(db);
    db.close();
    for (const n of NEW_INDEXES) expect(before.has(n)).toBe(false);

    await ensureDesktopSqliteDatabase();
    db = new Database(dbPath);
    const after = indexNames(db);
    db.close();
    for (const n of NEW_INDEXES) expect(after.has(n)).toBe(true);

    // Second run must not throw or change anything.
    await ensureDesktopSqliteDatabase();
    db = new Database(dbPath);
    const again = indexNames(db);
    db.close();
    expect(again).toEqual(after);
  });

  // SQL単体では起動時の補修経路を検査できないため、旧版の関数全体を実行する。
  // 全欠落に加え、各索引だけが欠落した既存DBでも旧版→現行版を比較する。
  const missingCases = [
    { name: '4索引すべて欠落', missing: NEW_INDEXES },
    ...NEW_INDEXES.map((name) => ({ name: `${name}のみ欠落`, missing: [name] })),
  ];
  test.each(missingCases)(
    '修正前後の起動処理を既存ファイルで比較: $name',
    async ({ missing }) => {
      const db = new Database(dbPath);
      try {
        db.exec('BEGIN');
        // 現行起動処理で準備せず、履歴に固定した旧SQLから既存DBを作る。
        db.exec(BEFORE_TASK1560_SQL);
        db.exec(
          "INSERT INTO User (id, username, email, updatedAt) VALUES (1560, 'task1560', 'task1560@example.test', 0)",
        );
        // 旧版が単に何もしなくても対照が通ることを防ぐ、既存self-healの正対照。
        db.exec('DROP INDEX "AgentExecution_workspaceId_idx"');
        for (const name of NEW_INDEXES.filter((name) => !missing.includes(name))) {
          const statement = SQLITE_INIT_SQL.split(';').find((s) => s.includes(`"${name}" ON`));
          expect(statement).toBeDefined();
          db.exec(statement!);
        }
        expect(NEW_INDEXES.filter((name) => !indexNames(db).has(name))).toEqual(missing);
        db.exec('COMMIT');
      } finally {
        db.close();
      }

      const oldPath = join(dir, 'before.db');
      copyFileSync(dbPath, oldPath);
      const readState = (path: string) => {
        const reopened = new Database(path, { readonly: true });
        try {
          expect(reopened.query('SELECT email FROM User WHERE id = 1560').get()).toEqual({
            email: 'task1560@example.test',
          });
          return indexNames(reopened);
        } finally {
          reopened.close();
        }
      };

      // 旧起動処理は別経路も含め2回実行する。旧宣言外の索引は既存の掃除で消える。
      process.env.DATABASE_URL = `file:${oldPath}`;
      for (let attempt = 0; attempt < 2; attempt++) {
        await ensureBeforeTask1560();
        const names = readState(oldPath);
        expect(NEW_INDEXES.filter((name) => names.has(name))).toEqual([]);
        expect(names.has('AgentExecution_workspaceId_idx')).toBe(true);
      }

      // 同じ初期状態のファイルへ現行版を実行。全欠落・一部欠落の両方を補修する。
      process.env.DATABASE_URL = `file:${dbPath}`;
      expect(NEW_INDEXES.filter((name) => !readState(dbPath).has(name))).toEqual(missing);
      let previous: Set<string> | undefined;
      for (let attempt = 0; attempt < 2; attempt++) {
        await ensureDesktopSqliteDatabase();
        const names = readState(dbPath);
        expect(NEW_INDEXES.filter((name) => names.has(name))).toEqual(NEW_INDEXES);
        expect(names.has('AgentExecution_workspaceId_idx')).toBe(true);
        if (previous) expect(names).toEqual(previous);
        previous = names;
      }
    },
    30_000,
  );

  test('stale-index cleanup keeps the new indexes', async () => {
    await ensureDesktopSqliteDatabase();
    const db = new Database(dbPath);
    dropStaleIndexes(db, SQLITE_INIT_SQL, dbPath);
    const names = indexNames(db);
    db.close();
    for (const n of NEW_INDEXES) expect(names.has(n)).toBe(true);
  });

  test('stale-index cleanup tolerates IF NOT EXISTS declarations', () => {
    const db = new Database(':memory:');
    db.exec('CREATE TABLE "A" ("b" INTEGER)');
    db.exec('CREATE INDEX "A_b_idx" ON "A"("b")');
    db.exec('CREATE INDEX "Z_b_idx" ON "A"("b")'); // undeclared: proves the declared set was parsed
    // Floor of 50 declared indexes: pad with distinct IF NOT EXISTS declarations.
    const padding = Array.from(
      { length: 60 },
      (_, i) => `CREATE INDEX IF NOT EXISTS "P${i}_x_idx" ON "A"("b")`,
    ).join(';\n');
    const sql = `${padding};\nCREATE INDEX IF NOT EXISTS "A_b_idx" ON "A"("b");\n`;
    const dropped = dropStaleIndexes(db, sql, ':memory:');
    const names = indexNames(db);
    db.close();
    expect(dropped).toBe(1);
    expect(names.has('A_b_idx')).toBe(true);
    expect(names.has('Z_b_idx')).toBe(false);
  });
});

describe('query plans use the new indexes', () => {
  const cases: Array<{ name: string; sql: string; index: string }> = [
    {
      name: 'execution by session',
      sql: 'SELECT * FROM "AgentExecution" WHERE "sessionId" = 1',
      index: 'AgentExecution_sessionId_idx',
    },
    {
      name: 'session by config',
      sql: 'SELECT * FROM "AgentSession" WHERE "configId" = 1',
      index: 'AgentSession_configId_idx',
    },
    {
      name: 'recent completed executions',
      sql: 'SELECT * FROM "AgentExecution" WHERE "completedAt" > 1000 ORDER BY "completedAt" DESC LIMIT 10',
      index: 'AgentExecution_completedAt_idx',
    },
    {
      name: 'latest timeline event by type',
      sql: 'SELECT * FROM "TimelineEvent" WHERE "eventType" = \'x\' ORDER BY "createdAt" DESC LIMIT 10',
      index: 'TimelineEvent_eventType_createdAt_idx',
    },
  ];
  test.each(cases)('$name uses $index', ({ sql, index }) => {
    const db = new Database(':memory:');
    db.exec(SQLITE_INIT_SQL);
    const plan = (db.query(`EXPLAIN QUERY PLAN ${sql}`).all() as Array<{ detail: string }>)
      .map((r) => r.detail)
      .join(' | ');
    db.close();
    expect(plan).toContain(index);
  });
});
