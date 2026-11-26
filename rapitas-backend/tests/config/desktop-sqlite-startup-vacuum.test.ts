/**
 * desktop-sqlite-startup-vacuum.test.ts
 *
 * Verifies that ensureDesktopSqliteDatabase (the real startup function) keeps
 * going after a startup VACUUM fails: the later repair step still runs, the
 * promise resolves, and the database is left intact.
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ensureDesktopSqliteDatabase } from '../../config/desktop-sqlite';
import { vacuumIfFragmented } from '../../config/desktop-sqlite-vacuum';

/** Removes a temp dir; Windows may hold the SQLite handle briefly, so retry and never fail the test. */
function cleanup(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    // leftover temp dir is harmless
  }
}

const NO_REPAIR_STATS = { scanned: 0, costUsdRepaired: 0, tokenColsRepaired: 0 };

describe('startup continues after a VACUUM failure', () => {
  let dir: string;
  let dbPath: string;
  const prevUrl = process.env.DATABASE_URL;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'startup-vacuum-'));
    dbPath = join(dir, 'test.db');
    process.env.DATABASE_URL = `file:${dbPath}`;
    // First start creates the schema; then leave >30% of the file as free pages.
    await ensureDesktopSqliteDatabase({ vacuum: () => undefined });
    const db = new Database(dbPath);
    db.exec('CREATE TABLE junk (id INTEGER PRIMARY KEY, payload TEXT)');
    const insert = db.prepare('INSERT INTO junk (payload) VALUES (?)');
    for (let i = 0; i < 3000; i++) insert.run('x'.repeat(2000));
    db.exec('DROP TABLE junk');
    db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
    db.close();
  });
  afterEach(() => {
    if (prevUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = prevUrl;
    cleanup(dir);
  });

  const failures = [
    ['database is locked', 'SQLITE_BUSY'],
    ['database or disk is full', 'SQLITE_FULL'],
    ['disk I/O error', 'SQLITE_IOERR'],
  ];

  test.each(failures)(
    'VACUUM failing with "%s" (%s) still reaches the repair step',
    async (message) => {
      let vacuumCalls = 0;
      let repairCalls = 0;
      const sizeBefore = statSync(dbPath).size;

      await ensureDesktopSqliteDatabase({
        vacuum: (path) => {
          vacuumCalls++;
          // Real vacuumIfFragmented: it must have decided to vacuum, then fail.
          return vacuumIfFragmented(path, {
            runVacuum: () => {
              throw new Error(message);
            },
          });
        },
        repairDecimals: () => {
          repairCalls++;
          return NO_REPAIR_STATS;
        },
      });

      expect(vacuumCalls).toBe(1);
      expect(repairCalls).toBe(1);
      // The file was not touched by the failed VACUUM, and the schema is intact.
      expect(statSync(dbPath).size).toBe(sizeBefore);
      const db = new Database(dbPath);
      const idx = db
        .query("SELECT name FROM sqlite_master WHERE name = 'AgentExecution_completedAt_idx'")
        .all();
      db.close();
      expect(idx).toHaveLength(1);
    },
  );

  test('a VACUUM step that throws outright does not stop startup', async () => {
    let repairCalls = 0;
    await ensureDesktopSqliteDatabase({
      vacuum: () => {
        throw new Error('unexpected');
      },
      repairDecimals: () => {
        repairCalls++;
        return NO_REPAIR_STATS;
      },
    });
    expect(repairCalls).toBe(1);
  });

  test('contrast: a successful VACUUM shrinks the file and the repair step still runs', async () => {
    let repairCalls = 0;
    const sizeBefore = statSync(dbPath).size;
    await ensureDesktopSqliteDatabase({
      repairDecimals: () => {
        repairCalls++;
        return NO_REPAIR_STATS;
      },
    });
    expect(statSync(dbPath).size).toBeLessThan(sizeBefore);
    expect(repairCalls).toBe(1);
  });
});
