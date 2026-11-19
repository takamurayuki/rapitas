/**
 * notes-schema.sqlite.test
 *
 * The notes stage-1 schema as the desktop database actually gets it: the
 * committed SQLite init SQL is executed in bun:sqlite and the foreign-key
 * behaviour the placement contract relies on is exercised (SetNull for
 * theme / category / folder / source task, Cascade for the completion
 * record). The PostgreSQL init SQL is checked to declare the same columns,
 * tables and constraints. Also: an existing desktop database (a Note table
 * from before stage 1) self-heals the new columns through addMissingColumns.
 */
import { describe, it, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { SQLITE_INIT_SQL } from '../../../src/generated/sqlite-init-sql';
import { POSTGRES_INIT_SQL } from '../../../src/generated/postgres-init-sql';
import { addMissingColumns } from '../../../config/desktop-sqlite';

const NEW_NOTE_COLUMNS = [
  'themeId',
  'categoryId',
  'folderId',
  'sourceTaskId',
  'followsTask',
  'source',
  'sourceRef',
];

function fresh(): Database {
  const db = new Database(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(SQLITE_INIT_SQL);
  const now = "'2026-11-19T00:00:00Z'";
  db.exec(`INSERT INTO "Category" ("id","name","updatedAt") VALUES (1,'c',${now})`);
  db.exec(`INSERT INTO "Theme" ("id","name","categoryId","updatedAt") VALUES (10,'t',1,${now})`);
  db.exec(`INSERT INTO "Task" ("id","title","themeId","updatedAt") VALUES (100,'x',10,${now})`);
  db.exec(`INSERT INTO "NoteFolder" ("id","name","updatedAt") VALUES (5,'f',${now})`);
  return db;
}

const note = (db: Database, id: string) =>
  db.query('SELECT * FROM "Note" WHERE id = ?').get(id) as Record<string, unknown>;

function insertNote(db: Database, id: string, cols: Record<string, number>) {
  const names = Object.keys(cols);
  db.query(
    `INSERT INTO "Note" ("id","title","updatedAt"${names.map((n) => `,"${n}"`).join('')}) VALUES (?,?,?${names.map(() => ',?').join('')})`,
  ).run(id, id, '2026-11-19T00:00:00Z', ...Object.values(cols));
}

describe('the SQLite init SQL (desktop)', () => {
  it('creates the placement columns with their defaults', () => {
    const db = fresh();
    insertNote(db, 'n', {});
    expect(note(db, 'n')).toMatchObject({
      themeId: null,
      categoryId: null,
      folderId: null,
      sourceTaskId: null,
      followsTask: 0,
      source: 'manual',
      sourceRef: null,
    });
  });

  it.each([
    ['Theme', 10, 'themeId'],
    ['Category', 1, 'categoryId'],
    ['NoteFolder', 5, 'folderId'],
    ['Task', 100, 'sourceTaskId'],
  ])('deleting a %s sets the note’s column to NULL and keeps the note', (table, id, column) => {
    const db = fresh();
    insertNote(db, 'n', { [column]: id });
    db.query(`DELETE FROM "${table}" WHERE id = ?`).run(id);
    expect(note(db, 'n')).toMatchObject({ [column]: null });
  });

  it('cascades the completion record with its task', () => {
    const db = fresh();
    db.exec(
      `INSERT INTO "TaskDeliverableCompletion" ("taskId","mode","completedAt","state") VALUES (100,'manual','2026-11-19T00:00:00Z','pending')`,
    );
    db.exec('DELETE FROM "Task" WHERE id = 100');
    expect(db.query('SELECT COUNT(*) AS n FROM "TaskDeliverableCompletion"').get()).toEqual({
      n: 0,
    });
  });

  it('keys the migration marker by its name', () => {
    const db = fresh();
    db.exec(`INSERT INTO "NoteMigrationMarker" ("key") VALUES ('k')`);
    expect(() => db.exec(`INSERT INTO "NoteMigrationMarker" ("key") VALUES ('k')`)).toThrow();
  });
});

describe('the PostgreSQL init SQL declares the same', () => {
  it.each([
    ...NEW_NOTE_COLUMNS.map((c) => `"${c}"`),
    'CREATE TABLE "NoteFolder"',
    'CREATE TABLE "TaskDeliverableCompletion"',
    'CREATE TABLE "NoteMigrationMarker"',
    '"Note_themeId_fkey" FOREIGN KEY ("themeId") REFERENCES "Theme"("id") ON DELETE SET NULL',
    '"Note_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL',
    '"Note_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "NoteFolder"("id") ON DELETE SET NULL',
    '"Note_sourceTaskId_fkey" FOREIGN KEY ("sourceTaskId") REFERENCES "Task"("id") ON DELETE SET NULL',
    '"TaskDeliverableCompletion_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE',
    'CREATE INDEX "Note_sourceTaskId_idx"',
  ])('%s', (fragment) => {
    expect(POSTGRES_INIT_SQL).toContain(fragment);
  });
});

describe('an existing desktop database (before stage 1)', () => {
  it('gets the new Note columns added by the self-heal', () => {
    const db = new Database(':memory:');
    db.exec(
      `CREATE TABLE "Note" ("id" TEXT NOT NULL PRIMARY KEY, "workspaceId" INTEGER, "title" TEXT NOT NULL, "content" TEXT NOT NULL DEFAULT '', "isPinned" BOOLEAN NOT NULL DEFAULT false, "tags" TEXT NOT NULL DEFAULT '[]', "color" TEXT, "docType" TEXT, "version" TEXT, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL)`,
    );
    db.exec(`INSERT INTO "Note" ("id","title","updatedAt") VALUES ('old','old','2026-01-01')`);
    const createNote = (SQLITE_INIT_SQL.match(/CREATE TABLE "Note" \([\s\S]*?\n\);/) ?? [''])[0];
    expect(addMissingColumns(db, 'Note', createNote, ':memory:')).toBe(NEW_NOTE_COLUMNS.length);
    expect(note(db, 'old')).toMatchObject({ source: 'manual', followsTask: 0, themeId: null });
  });

  it('has no foreign key on the healed sourceTaskId, so a task delete leaves the id dangling', () => {
    // Why the consistency check also clears a dangling sourceTaskId on notes
    // that no longer follow (review G2 must-fix 8; covered in
    // placement-consistency-job.test.ts).
    const db = new Database(':memory:');
    db.exec('PRAGMA foreign_keys = ON');
    db.exec(`CREATE TABLE "Task" ("id" INTEGER NOT NULL PRIMARY KEY, "title" TEXT NOT NULL)`);
    db.exec(
      `CREATE TABLE "Note" ("id" TEXT NOT NULL PRIMARY KEY, "workspaceId" INTEGER, "title" TEXT NOT NULL, "content" TEXT NOT NULL DEFAULT '', "isPinned" BOOLEAN NOT NULL DEFAULT false, "tags" TEXT NOT NULL DEFAULT '[]', "color" TEXT, "docType" TEXT, "version" TEXT, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL)`,
    );
    const createNote = (SQLITE_INIT_SQL.match(/CREATE TABLE "Note" \([\s\S]*?\n\);/) ?? [''])[0];
    addMissingColumns(db, 'Note', createNote, ':memory:');
    db.exec(`INSERT INTO "Task" ("id","title") VALUES (7,'t')`);
    db.exec(
      `INSERT INTO "Note" ("id","title","updatedAt","sourceTaskId","followsTask") VALUES ('d','d','2026-11-19',7,0)`,
    );
    db.exec(`DELETE FROM "Task" WHERE "id" = 7`);
    expect(note(db, 'd')).toMatchObject({ sourceTaskId: 7, followsTask: 0 });
  });
});
