/** 共有DBへ触れず、SQLiteの実クライアントで再起動用集計と項目保持を確認する。 */
import { afterAll, beforeEach, expect, mock, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '../../../generated/prisma-sqlite';

const dir = mkdtempSync(join(tmpdir(), 'restart-queue-sqlite-'));
const path = join(dir, 'queue.db');
const sql = new Database(path);
// 集計が読む列だけの独立したテストDB。製品のスキーマと生成物は変更しない。
sql.exec(`
  CREATE TABLE ThemeAutoRun (id INTEGER PRIMARY KEY, themeId INTEGER, enabled BOOLEAN, status TEXT);
  CREATE TABLE WorkflowQueueItem (id INTEGER PRIMARY KEY, taskId INTEGER, themeId INTEGER, status TEXT, result TEXT);
`);
const db = new PrismaClient({ datasources: { db: { url: 'file:' + path } } });
mock.module('../../../config/database', () => ({
  prisma: db,
  ensureDatabaseConnection: async () => {},
}));
const { countDispatchableQueued } = await import('./dispatchable-queue-depth');
const client = db as unknown as Parameters<typeof countDispatchableQueued>[0];

beforeEach(() => {
  sql.exec(`DELETE FROM WorkflowQueueItem; DELETE FROM ThemeAutoRun;
    INSERT INTO ThemeAutoRun VALUES (1,1,1,'paused_user'),(49,49,1,'paused_user');
    INSERT INTO WorkflowQueueItem VALUES (4713,1553,1,'queued',NULL);`);
});
afterAll(async () => {
  await db.$disconnect();
  sql.close();
  rmSync(dir, { recursive: true, force: true });
});

test('全テーマ停止ならqueuedを保持して再起動可能になる', async () => {
  expect(await countDispatchableQueued(client, false)).toBe(0);
  expect(await db.workflowQueueItem.count({ where: { id: 4713, status: 'queued' } })).toBe(1);
  sql.exec("UPDATE ThemeAutoRun SET status='running' WHERE themeId=1");
  expect(await countDispatchableQueued(client, false)).toBe(1);
});

test('runningとテーマ未指定のqueuedは再起動を待たせる', async () => {
  sql.exec("UPDATE ThemeAutoRun SET status='running' WHERE themeId=1");
  sql.exec("INSERT INTO WorkflowQueueItem VALUES (4714,1554,NULL,'queued',NULL)");
  expect(await countDispatchableQueued(client, false)).toBe(2);
});

test('待機中は全queuedを除外しても項目を削除しない', async () => {
  expect(await countDispatchableQueued(client, true)).toBe(0);
  expect(await db.workflowQueueItem.count()).toBe(1);
});
