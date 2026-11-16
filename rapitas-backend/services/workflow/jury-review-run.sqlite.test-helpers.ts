/**
 * jury-review-run.sqlite.test-helpers
 *
 * Test-only: a real SQLite database built from the production init SQL, with
 * config/database and config pointed at it, for the jury-lock and criteria
 * tests (companion design 4.5.1). The lock is decided by conditional-update
 * row counts, so it is tested on a real database, never on mocks.
 *
 * NOTE: Call installSqliteJuryHarness() before importing any module under
 * test — bun's mock.module only affects modules loaded after it.
 */
import { mock } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '../../generated/prisma-sqlite';
import { SQLITE_INIT_SQL } from '../../src/generated/sqlite-init-sql';

const noop = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

/**
 * Create the database and point the config modules at it.
 *
 * @returns The client and a cleanup / クライアントと後始末
 */
export function installSqliteJuryHarness(): { db: PrismaClient; dispose: () => Promise<void> } {
  const dir = mkdtempSync(join(tmpdir(), 'rapitas-jury-lock-'));
  const dbPath = join(dir, 'test.db');
  const init = new Database(dbPath);
  init.exec(SQLITE_INIT_SQL);
  init.close();
  const db = new PrismaClient({ datasources: { db: { url: `file:${dbPath}` } } });
  mock.module('../../config/logger', () => ({
    createLogger: () => noop,
    logger: noop,
    getBackendLogFilePath: () => join(dir, 'backend.log'),
  }));
  mock.module('../../config/database', () => ({
    prisma: db,
    ensureDatabaseConnection: async () => {},
  }));
  mock.module('../../config', () => ({
    prisma: db,
    ensureDatabaseConnection: async () => {},
    createLogger: () => noop,
    logger: noop,
    getDbProvider: () => 'sqlite',
    getInsensitiveMode: () => undefined,
    getProjectRoot: () => process.cwd(),
  }));
  return {
    db,
    dispose: async () => {
      await db.$disconnect();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

/**
 * A task row with criteria and a verify.md, ready to be judged.
 *
 * @param db - Client / クライアント
 * @param over - Column overrides / 列の上書き
 * @returns The task id / タスクID
 */
export async function seedJudgeableTask(
  db: PrismaClient,
  over: Record<string, unknown> = {},
): Promise<number> {
  const task = await db.task.create({
    data: {
      title: '一覧に検索を足す',
      status: 'in-progress',
      workflowStatus: 'in_progress',
      goals: JSON.stringify(['検索できる']),
      constraints: JSON.stringify([]),
      acceptanceCriteria: JSON.stringify(['キーワードで絞り込める', '0件のとき案内が出る']),
      ...over,
    },
  });
  await db.workflowFile.create({
    data: {
      taskId: task.id,
      fileType: 'verify',
      content: '# verify',
      sha256: 'verify-sha-1',
      sizeBytes: 8,
    },
  });
  return task.id;
}
