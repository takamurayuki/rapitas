/**
 * desktop-sqlite-self-heal.test.ts
 *
 * Verifies the column-level self-heal that adds columns present in the init SQL
 * but missing from an existing SQLite table (the `Task.goals` regression).
 */
import { describe, test, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { parseColumnDefs, addMissingColumns } from '../../config/desktop-sqlite';

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
