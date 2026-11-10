/**
 * session-cost-sweep-cursor
 *
 * Where the background session sweep (session-cost-sweep.ts) keeps its
 * position across restarts, so a run of short boots still moves it forward
 * instead of re-reading the first sessions every time (re-review4 P2). File
 * in RAPITAS_DATA_DIR (default ~/.rapitas), like the other small runtime
 * stores (auto-restart-merged-code/settings-store.ts, prompt-language-store.ts),
 * because a DB column would need a schema change (CLAUDE.md §1).
 * Not responsible for the walk itself.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';

/** Read/write of the last session id the sweep finished (0 = start of the ring). */
export interface SweepCursorStore {
  read(): number;
  write(cursor: number): void;
}

/** A finite, non-negative integer id; anything else restarts the ring at 0. */
const asCursor = (n: number) => (Number.isSafeInteger(n) && n > 0 ? n : 0);

/**
 * File-backed cursor (best-effort: an unreadable file restarts at 0, a failed
 * write only loses progress, neither stops the sweep).
 *
 * NOTE: The file is per data dir, not per database. A position carried over
 * from another database is harmless: the sweep wraps to the start at the end
 * of the ids, so it still reads every session once per lap.
 *
 * @param file - Override of the file path (tests) / ファイルパスの上書き（テスト用）
 * @returns The store / カーソルの保存先
 */
export function createFileSweepCursorStore(file?: string): SweepCursorStore {
  const path = () =>
    file ??
    join(
      process.env.RAPITAS_DATA_DIR?.trim() || join(homedir(), '.rapitas'),
      '.session-cost-sweep-cursor',
    );
  return {
    read() {
      try {
        return asCursor(Number(readFileSync(path(), 'utf8').trim()));
      } catch {
        return 0;
      }
    },
    write(cursor) {
      try {
        mkdirSync(dirname(path()), { recursive: true });
        writeFileSync(path(), String(asCursor(cursor)));
      } catch {
        // Losing the position only repeats some sessions on the next boot.
      }
    },
  };
}

/**
 * In-memory cursor (tests, and callers that must not touch the data dir).
 *
 * @param initial - Starting position / 初期位置
 * @returns The store / カーソルの保存先
 */
export function createMemorySweepCursorStore(initial = 0): SweepCursorStore {
  let cursor = asCursor(initial);
  return {
    read: () => cursor,
    write: (c) => {
      cursor = asCursor(c);
    },
  };
}
