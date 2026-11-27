/**
 * desktop-sqlite-vacuum.test.ts
 *
 * Verifies the startup VACUUM: it runs only when the freelist share reaches the
 * threshold, reports before/after size and duration, and never throws.
 */
import { describe, test, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  VACUUM_FREELIST_RATIO_THRESHOLD,
  shouldVacuum,
  vacuumIfFragmented,
} from '../../config/desktop-sqlite-vacuum';

/** Removes a temp dir; Windows may hold the SQLite handle briefly, so retry and never fail the test. */
function cleanup(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } catch {
    // leftover temp dir is harmless
  }
}

/** Creates a temp DB whose freelist share is roughly `deleteShare` of its pages. */
function makeDb(deleteShare: number): { dir: string; path: string } {
  const dir = mkdtempSync(join(tmpdir(), 'vacuum-test-'));
  const path = join(dir, 'test.db');
  const db = new Database(path);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, payload TEXT)');
  const filler = 'x'.repeat(2000);
  const insert = db.prepare('INSERT INTO t (payload) VALUES (?)');
  for (let i = 0; i < 400; i++) insert.run(filler);
  if (deleteShare > 0) {
    db.exec(`DELETE FROM t WHERE id > ${Math.round(400 * (1 - deleteShare))}`);
  }
  db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
  db.close();
  return { dir, path };
}

describe('shouldVacuum', () => {
  test('threshold is 30%', () => {
    expect(VACUUM_FREELIST_RATIO_THRESHOLD).toBe(0.3);
  });
  test('29 of 100 does not vacuum, 30 and 31 do', () => {
    expect(shouldVacuum(29, 100)).toBe(false);
    expect(shouldVacuum(30, 100)).toBe(true);
    expect(shouldVacuum(31, 100)).toBe(true);
  });
  test('empty database (page_count 0) never vacuums', () => {
    expect(shouldVacuum(0, 0)).toBe(false);
    expect(shouldVacuum(5, 0)).toBe(false);
  });
});

describe('vacuumIfFragmented', () => {
  test('runs once and shrinks the file when freelist share is high', () => {
    const { dir, path } = makeDb(0.6);
    try {
      const before = statSync(path).size;
      const result = vacuumIfFragmented(path);
      expect(result.ran).toBe(true);
      expect(result.sizeBefore).toBe(before);
      expect(result.sizeAfter).toBeLessThan(before);
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      const db = new Database(path);
      const free = db.query('PRAGMA freelist_count').get() as { freelist_count: number };
      db.close();
      expect(free.freelist_count).toBe(0);
    } finally {
      cleanup(dir);
    }
  });

  test('does not run when freelist share is low', () => {
    const { dir, path } = makeDb(0.1);
    try {
      let calls = 0;
      const result = vacuumIfFragmented(path, {
        runVacuum: () => {
          calls++;
        },
      });
      expect(result.ran).toBe(false);
      expect(calls).toBe(0);
    } finally {
      cleanup(dir);
    }
  });

  test('runs the injected VACUUM exactly once when fragmented', () => {
    const { dir, path } = makeDb(0.6);
    try {
      let calls = 0;
      const result = vacuumIfFragmented(path, {
        runVacuum: () => {
          calls++;
        },
      });
      expect(result.ran).toBe(true);
      expect(calls).toBe(1);
    } finally {
      cleanup(dir);
    }
  });

  test('swallows a VACUUM failure and reports it', () => {
    const { dir, path } = makeDb(0.6);
    try {
      const result = vacuumIfFragmented(path, {
        runVacuum: () => {
          throw new Error('database is locked');
        },
      });
      expect(result.ran).toBe(false);
      expect(result.error).toContain('database is locked');
    } finally {
      cleanup(dir);
    }
  });

  test('missing database file does not throw', () => {
    const result = vacuumIfFragmented(join(tmpdir(), 'no-such-dir-xyz', 'nope.db'));
    expect(result.ran).toBe(false);
  });
});
