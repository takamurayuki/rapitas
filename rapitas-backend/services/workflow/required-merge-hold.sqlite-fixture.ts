/** 共通holdの実呼び出し元を接続する、隔離SQLiteの試験用fixture。 */
import { afterAll, expect, mock } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '../../generated/prisma-sqlite';
import { SQLITE_INIT_SQL } from '../../src/generated/sqlite-init-sql';

const dir = mkdtempSync(join(tmpdir(), 'rapitas-hold-callers-'));
const dbPath = join(dir, 'test.db');
const init = new Database(dbPath);
init.exec(SQLITE_INIT_SQL);
init.close();
export const db = new PrismaClient({ datasources: { db: { url: `file:${dbPath}` } } });
const logger = { info() {}, debug() {}, warn() {}, error() {} };
mock.module('../../config/database', () => ({
  prisma: db,
  ensureDatabaseConnection: async () => {},
}));
mock.module('../../config/logger', () => ({
  logger,
  createLogger: () => logger,
  getBackendLogFilePath: () => '/tmp/backend.log',
}));
const config = await import('../../config');
mock.module('../../config', () => ({ ...config, prisma: db }));

afterAll(async () => {
  await db.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

export async function createHeldCandidate(status = 'in-progress', phase = 'verify') {
  const theme = await db.theme.create({ data: { name: '接続試験', isDevelopment: true } });
  await db.themeAutoRun.create({ data: { themeId: theme.id, enabled: true, status: 'running' } });
  const task = await db.task.create({
    data: {
      title: '実呼び出し元',
      status,
      workflowStatus: 'verify_done',
      themeId: theme.id,
      githubPrId: 7,
    },
  });
  const item = await db.workflowQueueItem.create({
    data: {
      taskId: task.id,
      themeId: theme.id,
      status: 'running',
      currentPhase: phase,
    },
  });
  return { task, item };
}

export async function expectHeld(
  taskId: number,
  itemId: number,
  source: string,
  phase = 'ci_wait',
) {
  expect(await db.task.findUniqueOrThrow({ where: { id: taskId } })).toMatchObject({
    status: 'in-progress',
    workflowStatus: 'verify_done',
  });
  expect(await db.workflowQueueItem.findUniqueOrThrow({ where: { id: itemId } })).toMatchObject({
    status: 'running',
    currentPhase: phase,
  });
  const transition = await db.workflowTransition.findFirstOrThrow({
    where: { taskId, cause: 'verify_awaiting_required_merge' },
    orderBy: { createdAt: 'desc' },
  });
  expect(JSON.parse(transition.metadata!)).toMatchObject({ source });
}
