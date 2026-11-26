/**
 * desktop-sqlite-vacuum
 *
 * Compacts the desktop SQLite file at startup when it holds many free pages.
 * It never decides whether startup continues: every failure is swallowed.
 */
import { statSync } from 'fs';
import { createLogger } from './logger';

const log = createLogger('desktop-sqlite-vacuum');

/**
 * Share of free pages at which a startup VACUUM is worth doing.
 *
 * VACUUM rewrites the whole file, so it is only worth its cost when a large
 * part of the file is dead space. The live DB measured 40% free (311MB of
 * 784MB) on 2026-11-26, which slows every scan; below 30% the saving is small
 * compared with rewriting hundreds of MB on each start.
 */
export const VACUUM_FREELIST_RATIO_THRESHOLD = 0.3;

/** Outcome of a vacuum attempt. */
export interface VacuumResult {
  ran: boolean;
  sizeBefore: number;
  sizeAfter: number;
  durationMs: number;
  error?: string;
}

/** Test seam: replaces the real VACUUM statement. */
export interface VacuumOptions {
  runVacuum?: (database: import('bun:sqlite').Database) => void;
}

/**
 * Decides whether the free-page share justifies a VACUUM.
 *
 * @param freelistCount - PRAGMA freelist_count / 空きページ数
 * @param pageCount - PRAGMA page_count / 総ページ数
 * @returns true when freelist/page ratio >= threshold; false for an empty DB / 割合がしきい値以上なら true
 */
export function shouldVacuum(freelistCount: number, pageCount: number): boolean {
  if (pageCount <= 0) return false;
  return freelistCount / pageCount >= VACUUM_FREELIST_RATIO_THRESHOLD;
}

/**
 * Runs VACUUM once if the database is fragmented enough, logging size and time.
 *
 * Must be called while no other connection of this process is open and before
 * the Prisma engine starts (#1000: closing bun:sqlite after Prisma began
 * removed the WAL and caused SQLite 522).
 *
 * @param databasePath - Absolute SQLite file path / SQLite ファイルの絶対パス
 * @param options - Test seam / テスト用の差し替え
 * @returns What happened; never throws / 結果（例外は投げない）
 */
export function vacuumIfFragmented(
  databasePath: string,
  options: VacuumOptions = {},
): VacuumResult {
  const result: VacuumResult = { ran: false, sizeBefore: 0, sizeAfter: 0, durationMs: 0 };
  let database: import('bun:sqlite').Database | undefined;
  try {
    const { Database } = require('bun:sqlite') as typeof import('bun:sqlite');
    database = new Database(databasePath, { readwrite: true, create: false });
    // Fail fast instead of waiting on a leftover process that holds the file.
    database.exec('PRAGMA busy_timeout = 2000;');
    const freelist = (database.query('PRAGMA freelist_count').get() as { freelist_count: number })
      .freelist_count;
    const pages = (database.query('PRAGMA page_count').get() as { page_count: number }).page_count;
    if (!shouldVacuum(freelist, pages)) return result;

    result.sizeBefore = statSync(databasePath).size;
    const started = performance.now();
    try {
      (options.runVacuum ?? ((db) => db.exec('VACUUM')))(database);
    } finally {
      result.durationMs = Math.round(performance.now() - started);
    }
    result.ran = true;
    // In WAL mode the VACUUM output sits in the WAL until checkpointed, so the
    // main file would keep its old size and the log would report no saving.
    database.exec('PRAGMA wal_checkpoint(TRUNCATE);');
    database.close();
    database = undefined;
    result.sizeAfter = statSync(databasePath).size;
    log.info(
      {
        databasePath,
        freelistPages: freelist,
        totalPages: pages,
        sizeBefore: result.sizeBefore,
        sizeAfter: result.sizeAfter,
        durationMs: result.durationMs,
      },
      'Compacted SQLite database with VACUUM',
    );
  } catch (err) {
    result.ran = false;
    result.error = err instanceof Error ? err.message : String(err);
    log.warn({ err, databasePath }, 'Startup VACUUM failed (non-fatal)');
  } finally {
    try {
      database?.close();
    } catch {
      // already closed or unusable; nothing more to release
    }
  }
  return result;
}
