/**
 * required-merge-hold.sqlite.test
 *
 * Pins, against a real SQLite database built from the production init SQL, that
 * holdForRequiredMerge({ requireNotExcluded: true }) loses to an operator exclusion that
 * lands after the caller's own read (task 1563). A mocked updateMany can only imitate the
 * where clause; here the database itself decides whether the CAS matches.
 */
import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '../../generated/prisma-sqlite';
import { SQLITE_INIT_SQL } from '../../src/generated/sqlite-init-sql';

const dir = mkdtempSync(join(tmpdir(), 'rapitas-merge-hold-'));
const dbPath = join(dir, 'test.db');
const init = new Database(dbPath);
init.exec(SQLITE_INIT_SQL);
init.close();
const db = new PrismaClient({ datasources: { db: { url: `file:${dbPath}` } } });

const noopLogger = { info() {}, warn() {}, error() {}, debug() {}, fatal() {} };
mock.module('../../config/database', () => ({
  ensureDatabaseConnection: () => Promise.resolve(),
  prisma: db,
}));
mock.module('../../config/logger', () => ({
  createLogger: () => noopLogger,
  logger: noopLogger,
  getBackendLogFilePath: () => '/tmp/backend.log',
}));
const recordTransition = mock(() => Promise.resolve());
mock.module('./transition-recorder', () => ({ recordTransition }));

const { holdForRequiredMerge } = await import('./required-merge-hold');

afterAll(async () => {
  await db.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(async () => {
  recordTransition.mockClear();
  await db.task.deleteMany();
});

const blockedTask = (autoRunExcluded: boolean) =>
  db.task.create({
    data: {
      title: 'blocked at verify_done',
      status: 'blocked',
      workflowStatus: 'verify_done',
      autoRunExcluded,
    },
  });

const retryHold = (taskId: number, requireNotExcluded: boolean) =>
  holdForRequiredMerge({
    taskId,
    fromStatus: 'verify_done',
    fromStatusIn: ['blocked'],
    source: 'test',
    requireNotExcluded,
  });

describe('holdForRequiredMerge requireNotExcluded on a real SQLite row (task 1563)', () => {
  test('除外されていないタスクは in-progress + verify_done に戻り、遷移を記録する', async () => {
    const t = await blockedTask(false);
    expect(await retryHold(t.id, true)).toBe(true);
    const row = await db.task.findUniqueOrThrow({ where: { id: t.id } });
    expect(row).toMatchObject({ status: 'in-progress', workflowStatus: 'verify_done' });
    expect(recordTransition).toHaveBeenCalledTimes(1);
  });

  test('呼び出し側の読み取りの後に対象外へ更新されたタスクは更新件数 0 で、状態も遷移も変わらない', async () => {
    const t = await blockedTask(false);
    // the caller read autoRunExcluded=false here; the operator excludes it before the write
    await db.task.update({ where: { id: t.id }, data: { autoRunExcluded: true } });

    expect(await retryHold(t.id, true)).toBe(false);

    const row = await db.task.findUniqueOrThrow({ where: { id: t.id } });
    expect(row).toMatchObject({ status: 'blocked', workflowStatus: 'verify_done' });
    expect(recordTransition).not.toHaveBeenCalled();
  });

  test('requireNotExcluded を付けない既存の呼び出しは対象外タスクにも従来どおり書く（互換）', async () => {
    const t = await blockedTask(true);
    expect(await retryHold(t.id, false)).toBe(true);
    const row = await db.task.findUniqueOrThrow({ where: { id: t.id } });
    expect(row.status).toBe('in-progress');
  });

  test('blocked でなくなったタスクは書かない（status の CAS）', async () => {
    const t = await db.task.create({
      data: { title: 'already done', status: 'done', workflowStatus: 'verify_done' },
    });
    expect(await retryHold(t.id, true)).toBe(false);
    expect((await db.task.findUniqueOrThrow({ where: { id: t.id } })).status).toBe('done');
  });
});
