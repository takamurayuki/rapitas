/**
 * repair-corrupted-decimals.test
 *
 * 2026-11-27: the startup repair left its bun:sqlite connection alive (an
 * unfinalized prepare() turns close() into a deferred close). The real close
 * then ran at GC time after Prisma had opened the same file and deleted the WAL
 * under it — SQLite 522 then "database disk image is malformed" on a fresh CI
 * DB, which broke Browser E2E and Fault Injection E2E about 40% of boots.
 * The last real close deletes the -wal / -shm files, so their absence proves
 * the connection is truly gone.
 */
import { afterEach, describe, expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { repairCorruptedDecimals } from './repair-corrupted-decimals';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function walDatabase(rows: Array<[number, string]>): string {
  const dir = mkdtempSync(join(tmpdir(), 'rapitas-repair-'));
  dirs.push(dir);
  const path = join(dir, 'test.db');
  const db = new Database(path);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec(
    'CREATE TABLE AgentExecution (id INTEGER PRIMARY KEY, costUsd TEXT, inputTokens INTEGER, outputTokens INTEGER, cacheReadInputTokens INTEGER, cacheCreationInputTokens INTEGER, tokensUsed INTEGER)',
  );
  const insert = db.prepare('INSERT INTO AgentExecution VALUES (?, ?, 0, 0, 0, 0, 0)');
  for (const [id, cost] of rows) insert.run(id, cost);
  insert.finalize();
  db.close();
  return path;
}

describe('repairCorruptedDecimals', () => {
  test('repairs a double-encoded cost and really closes its connection', () => {
    const path = walDatabase([
      [1, '"\\"0.5\\""'],
      [2, '1.25'],
    ]);
    const stats = repairCorruptedDecimals(path);
    expect(stats.costUsdRepaired).toBe(1);
    // A live connection keeps the WAL files; only the last real close removes them.
    expect(existsSync(`${path}-wal`)).toBe(false);
    expect(existsSync(`${path}-shm`)).toBe(false);
  });

  test('closes the connection when nothing needs repair', () => {
    const path = walDatabase([[1, '2']]);
    repairCorruptedDecimals(path);
    expect(existsSync(`${path}-wal`)).toBe(false);
  });
});
