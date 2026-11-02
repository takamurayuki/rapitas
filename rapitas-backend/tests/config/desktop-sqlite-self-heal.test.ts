/**
 * desktop-sqlite-self-heal.test.ts
 *
 * Verifies the column-level self-heal that adds columns present in the init SQL
 * but missing from an existing SQLite table (the `Task.goals` regression).
 */
import { describe, test, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { parseColumnDefs, addMissingColumns, dropStaleIndexes } from '../../config/desktop-sqlite';

const TASK_CREATE = `CREATE TABLE "Task" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "title" TEXT NOT NULL,
    "labels" TEXT NOT NULL DEFAULT '[]',
    "goals" TEXT,
    "constraints" TEXT,
    "acceptanceCriteria" TEXT,
    "parentId" INTEGER,
    CONSTRAINT "Task_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Task" ("id")
)`;

describe('parseColumnDefs', () => {
  test('extracts columns and skips table-level constraints', () => {
    const cols = parseColumnDefs(TASK_CREATE).map((c) => c.name);
    expect(cols).toContain('goals');
    expect(cols).toContain('constraints');
    expect(cols).toContain('acceptanceCriteria');
    // The FOREIGN KEY constraint must NOT be treated as a column.
    expect(cols).not.toContain('Task_parentId_fkey');
    expect(cols).toEqual([
      'id',
      'title',
      'labels',
      'goals',
      'constraints',
      'acceptanceCriteria',
      'parentId',
    ]);
  });

  test('returns [] for a statement without a body', () => {
    expect(parseColumnDefs('CREATE TABLE "X"')).toEqual([]);
  });
});

describe('addMissingColumns', () => {
  test('adds only the columns missing from an existing table', () => {
    const db = new Database(':memory:');
    // Existing table predates the goals/constraints/acceptanceCriteria columns.
    db.exec(`CREATE TABLE "Task" (
      "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
      "title" TEXT NOT NULL,
      "labels" TEXT NOT NULL DEFAULT '[]',
      "parentId" INTEGER
    )`);

    const added = addMissingColumns(db, 'Task', TASK_CREATE, ':memory:');
    expect(added).toBe(3);

    const cols = new Set(
      (db.query('PRAGMA table_info("Task")').all() as Array<{ name: string }>).map((r) => r.name),
    );
    expect(cols.has('goals')).toBe(true);
    expect(cols.has('constraints')).toBe(true);
    expect(cols.has('acceptanceCriteria')).toBe(true);

    // Inserting a row that sets the new columns must now succeed.
    db.exec(`INSERT INTO "Task" ("title", "goals") VALUES ('t', '["g"]')`);
    const row = db.query('SELECT goals FROM "Task" WHERE title = ?').get('t') as { goals: string };
    expect(row.goals).toBe('["g"]');
    db.close();
  });

  test('is idempotent — a second run adds nothing', () => {
    const db = new Database(':memory:');
    db.exec(`CREATE TABLE "Task" ("id" INTEGER PRIMARY KEY, "title" TEXT NOT NULL)`);

    expect(addMissingColumns(db, 'Task', TASK_CREATE, ':memory:')).toBeGreaterThan(0);
    expect(addMissingColumns(db, 'Task', TASK_CREATE, ':memory:')).toBe(0);
    db.close();
  });
});

describe('dropStaleIndexes', () => {
  /*
   * The self-heal can add a table, a column or an index, but until now it had
   * no way to DROP one — measured against the live database on 2026-10-28, it
   * held 284 indexes where the init SQL declared 275, and the 9 extra had
   * survived the removal of the models they belonged to.
   *
   * That gap is what makes a uniqueness change inert: turning `@unique` into
   * `@@unique([workspaceId, key])` creates the new index and leaves the old
   * global one enforcing, so the second workspace still cannot insert. The
   * schema would say one thing and the database another, with nothing to say so.
   */
  // The real init SQL declares 275 indexes, and the cleanup refuses to act on
  // one that declares implausibly few — a truncated regeneration would
  // otherwise read as "the schema wants none" and take them all. So the
  // fixture is padded past that floor rather than the floor being lowered for
  // the test: the production default is what runs here.
  const FILLER = Array.from(
    { length: 60 },
    (_, i) => `CREATE INDEX "Filler${i}_x_idx" ON "Filler${i}"("x");`,
  );
  const INIT = [
    'CREATE TABLE "Thing" ("id" INTEGER PRIMARY KEY, "key" TEXT NOT NULL, "workspaceId" INTEGER);',
    'CREATE UNIQUE INDEX "Thing_workspaceId_key_key" ON "Thing"("workspaceId", "key");',
    'CREATE INDEX "Thing_key_idx" ON "Thing"("key");',
    ...FILLER,
  ].join('\n');

  /** A database holding the OLD global unique plus a hand-made index. */
  function dbWithStaleIndexes(): Database {
    const db = new Database(':memory:');
    db.exec(
      'CREATE TABLE "Thing" ("id" INTEGER PRIMARY KEY, "key" TEXT NOT NULL, "workspaceId" INTEGER)',
    );
    db.exec('CREATE UNIQUE INDEX "Thing_key_key" ON "Thing"("key")');
    db.exec('CREATE UNIQUE INDEX "Thing_workspaceId_key_key" ON "Thing"("workspaceId", "key")');
    db.exec('CREATE INDEX "Thing_key_idx" ON "Thing"("key")');
    db.exec('CREATE INDEX "hand_rolled_by_an_operator" ON "Thing"("id")');
    return db;
  }

  const indexNames = (db: Database): string[] =>
    (
      db
        .query("SELECT name FROM sqlite_master WHERE type='index' AND sql IS NOT NULL")
        .all() as Array<{ name: string }>
    )
      .map((r) => r.name)
      .sort();

  test('drops the superseded unique index the schema no longer declares', () => {
    const db = dbWithStaleIndexes();
    expect(dropStaleIndexes(db, INIT, ':memory:')).toBe(1);
    expect(indexNames(db)).toEqual([
      'Thing_key_idx',
      'Thing_workspaceId_key_key',
      'hand_rolled_by_an_operator',
    ]);
    db.close();
  });

  test('the point of it: the second workspace can now insert its own row', () => {
    // Without the drop this INSERT fails, which is the whole defect — the
    // schema change would be in the generated client and inert in the database.
    const db = dbWithStaleIndexes();
    db.run('INSERT INTO "Thing" ("key","workspaceId") VALUES (?,?)', ['shared', 1]);
    expect(() =>
      db.run('INSERT INTO "Thing" ("key","workspaceId") VALUES (?,?)', ['shared', 2]),
    ).toThrow();

    dropStaleIndexes(db, INIT, ':memory:');
    db.run('INSERT INTO "Thing" ("key","workspaceId") VALUES (?,?)', ['shared', 2]);
    const rows = db.query('SELECT COUNT(*) AS c FROM "Thing"').get() as { c: number };
    expect(rows.c).toBe(2);
    db.close();
  });

  test('leaves an index a human added alone — only Prisma-named ones are ours', () => {
    const db = dbWithStaleIndexes();
    dropStaleIndexes(db, INIT, ':memory:');
    expect(indexNames(db)).toContain('hand_rolled_by_an_operator');
    db.close();
  });

  test('is idempotent — a second run drops nothing', () => {
    const db = dbWithStaleIndexes();
    expect(dropStaleIndexes(db, INIT, ':memory:')).toBe(1);
    expect(dropStaleIndexes(db, INIT, ':memory:')).toBe(0);
    db.close();
  });

  test('refuses to act on init SQL that declares nothing', () => {
    // A failed regeneration leaves an empty or truncated init SQL. Treating
    // that as "the schema wants no indexes" would drop every one of them, so
    // the drop is skipped rather than trusted.
    const db = dbWithStaleIndexes();
    const before = indexNames(db);
    expect(dropStaleIndexes(db, 'CREATE TABLE "Thing" ("id" INTEGER);', ':memory:')).toBe(0);
    expect(indexNames(db)).toEqual(before);
    db.close();
  });
});
