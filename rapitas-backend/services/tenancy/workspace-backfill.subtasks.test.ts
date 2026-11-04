/**
 * workspace-backfill: subtasks adopt their parent's workspace
 *
 * Runs the real statement against an in-memory SQLite table shaped like the
 * columns it touches, so what is pinned is the SQL's effect and not only its
 * text. Subtasks created by sessionless requests were left NULL under owned
 * parents (tasks 1428/1480/1481); the backfill has to give them their
 * parent's workspace, and nothing else.
 */
import { describe, it, expect, beforeEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { adoptOrphanedSubtasks, type RawExecutor } from './workspace-backfill';

let raw: Database;
let db: RawExecutor;

/** Insert a task row; `updatedAt` is fixed so a stray touch is visible. */
function task(id: number, parentId: number | null, workspaceId: number | null): void {
  raw.run('INSERT INTO "Task" ("id","parentId","workspaceId","updatedAt") VALUES (?,?,?,?)', [
    id,
    parentId,
    workspaceId,
    1000,
  ]);
}

/** The workspace a row ends up in. */
function workspaceOf(id: number): number | null {
  const row = raw.query('SELECT "workspaceId" AS w FROM "Task" WHERE "id" = ?').get(id) as {
    w: number | null;
  };
  return row.w;
}

beforeEach(() => {
  raw = new Database(':memory:');
  raw.exec(
    'CREATE TABLE "Task" ("id" INTEGER PRIMARY KEY, "parentId" INTEGER, "workspaceId" INTEGER, "updatedAt" INTEGER)',
  );
  db = {
    $executeRawUnsafe: (sql: string) => Promise.resolve(raw.run(sql).changes),
  };
});

describe('adoptOrphanedSubtasks', () => {
  it('gives an unowned subtask its parent workspace', async () => {
    task(532, null, 1);
    task(1428, 532, null);
    const result = await adoptOrphanedSubtasks(db);
    expect(workspaceOf(1428)).toBe(1);
    expect(result.adopted).toBe(1);
  });

  it('follows a chain down, so a grandchild is adopted too', async () => {
    task(1, null, 1);
    task(2, 1, null);
    task(3, 2, null);
    const result = await adoptOrphanedSubtasks(db);
    expect([workspaceOf(2), workspaceOf(3)]).toEqual([1, 1]);
    expect(result.adopted).toBe(2);
  });

  it('leaves alone what it has no answer for or no business with', async () => {
    task(10, null, null); // an unowned root: claimUnownedRows' job, not this one's
    task(11, 10, null); // its child has no workspace to inherit
    task(20, null, 1);
    task(21, 20, 2); // already owned: never moved between workspaces
    await adoptOrphanedSubtasks(db);
    expect([workspaceOf(10), workspaceOf(11), workspaceOf(21)]).toEqual([null, null, 2]);
  });

  it('does not touch updatedAt, and a second run finds nothing', async () => {
    task(532, null, 1);
    task(1428, 532, null);
    await adoptOrphanedSubtasks(db);
    const again = await adoptOrphanedSubtasks(db);
    expect(again.adopted).toBe(0);
    const row = raw.query('SELECT "updatedAt" AS u FROM "Task" WHERE "id" = 1428').get() as {
      u: number;
    };
    expect(row.u).toBe(1000);
  });
});
