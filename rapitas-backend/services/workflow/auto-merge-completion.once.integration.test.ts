/**
 * auto-merge-completion.once.integration.test
 *
 * Task 1568 against a REAL SQLite database: the merge watcher's completion write is conditional
 * on the held shape, so it is written — and its deliverable record created — exactly once even when
 * the completion is attempted twice.
 */
import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '../../generated/prisma-sqlite';
import { SQLITE_INIT_SQL } from '../../src/generated/sqlite-init-sql';

const dir = mkdtempSync(join(tmpdir(), 'rapitas-runner-own-'));
const dbPath = join(dir, 'test.db');
const init = new Database(dbPath);
init.exec(SQLITE_INIT_SQL);
init.close();
const db = new PrismaClient({ datasources: { db: { url: `file:${dbPath}` } } });

const logger = { info() {}, debug() {}, warn() {}, error() {} };
mock.module('../../config/database', () => ({ prisma: db }));
mock.module('../../config/logger', () => ({
  getBackendLogFilePath: () => '/tmp/backend.log',
  logger,
  createLogger: () => logger,
}));
const realConfig = await import('../../config');
mock.module('../../config', () => ({ ...realConfig, prisma: db, createLogger: () => logger }));

mock.module('./auto-merge-task-guard', () => ({ canContinueAutoMerge: async () => true }));
mock.module('./verifier-completion-check', () => ({
  verifierConfirmedForCompletion: async () => true,
}));
const { completeTaskRow } = await import('./auto-merge-completion');

afterAll(async () => {
  await db.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(async () => {
  await db.taskDeliverableCompletion.deleteMany();
  await db.task.deleteMany();
});

describe('completeTaskRow writes the completion once', () => {
  test('called twice: [true, false], one record, the task completed', async () => {
    const task = await db.task.create({
      data: { title: 'A', status: 'in-progress', workflowStatus: 'verify_done' },
    });
    const results = [await completeTaskRow(task.id), await completeTaskRow(task.id)];
    expect(results).toEqual([true, false]);
    expect(await db.task.findUniqueOrThrow({ where: { id: task.id } })).toMatchObject({
      status: 'done',
      workflowStatus: 'completed',
    });
    expect(await db.taskDeliverableCompletion.count({ where: { taskId: task.id } })).toBe(1);
  });

  test('a task that left the held shape (e.g. sent to repair) is not completed', async () => {
    const task = await db.task.create({
      data: { title: 'B', status: 'in-progress', workflowStatus: 'implement' },
    });
    expect(await completeTaskRow(task.id)).toBe(false);
    expect((await db.task.findUniqueOrThrow({ where: { id: task.id } })).status).toBe(
      'in-progress',
    );
    expect(await db.taskDeliverableCompletion.count({ where: { taskId: task.id } })).toBe(0);
  });
});
