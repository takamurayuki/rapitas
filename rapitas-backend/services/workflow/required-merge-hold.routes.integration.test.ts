/**
 * required-merge-hold.routes.integration.test
 *
 * Task 1568 against a REAL SQLite database: every caller of the shared hold (the six production
 * call shapes: source, observed workflow status, widened task status) puts the task's RUNNING queue
 * item into the CI-wait phase in the same transaction, so the scheduler's hand-back can release it
 * whichever path parked the task. A lost hold CAS leaves the item alone.
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

const { holdForRequiredMerge } = await import('./required-merge-hold');
const { handBackAwaitingCiItems } = await import('./auto-run/awaiting-ci-release-txn');

afterAll(async () => {
  await db.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

beforeEach(async () => {
  await db.workflowQueueItem.deleteMany();
  await db.workflowTransition.deleteMany();
  await db.task.deleteMany();
});

// The call shapes found in production (grep holdForRequiredMerge).
const SHAPES = [
  { source: 'post-execution-review', status: 'in-progress', wf: 'verify' },
  { source: 'verify-commit-pr:conflict-resolution', status: 'in-progress', wf: 'verify_done' },
  {
    source: 'blocked-pr-retry-recovery',
    status: 'blocked',
    wf: 'verify_done',
    fromStatusIn: ['blocked'],
  },
  { source: 'review-hold-override', status: 'in-progress', wf: 'verify_done' },
  { source: 'subtask-completion-handler', status: 'in-progress', wf: 'verify_done' },
  { source: 'WorkflowCLIExecutor', status: 'in-progress', wf: 'in_progress' },
  { source: 'WorkflowCLIExecutor (staged pr)', status: 'in-progress', wf: 'in_progress' },
];

describe('every hold path moves the running item to ci_wait', () => {
  test.each(SHAPES)('$source', async (shape) => {
    const task = await db.task.create({
      data: { title: shape.source, status: shape.status, workflowStatus: shape.wf },
    });
    const item = await db.workflowQueueItem.create({
      data: { taskId: task.id, status: 'running', currentPhase: shape.wf, startedAt: new Date() },
    });
    const held = await holdForRequiredMerge({
      taskId: task.id,
      fromStatus: shape.wf,
      source: shape.source,
      ...(shape.fromStatusIn ? { fromStatusIn: shape.fromStatusIn } : {}),
    });
    expect(held).toBe(true);
    expect(
      (await db.workflowQueueItem.findUniqueOrThrow({ where: { id: item.id } })).currentPhase,
    ).toBe('ci_wait');
    expect(await handBackAwaitingCiItems(db as never, task.id, [item.id])).toEqual({
      result: 'released',
      count: 1,
    });
  });

  test('a path whose hold CAS loses leaves the item untouched', async () => {
    const task = await db.task.create({
      data: { title: 'x', status: 'done', workflowStatus: 'completed' },
    });
    const item = await db.workflowQueueItem.create({
      data: { taskId: task.id, status: 'running', currentPhase: 'verify', startedAt: new Date() },
    });
    expect(await holdForRequiredMerge({ taskId: task.id, fromStatus: 'verify', source: 't' })).toBe(
      false,
    );
    expect(
      (await db.workflowQueueItem.findUniqueOrThrow({ where: { id: item.id } })).currentPhase,
    ).toBe('verify');
  });

  test('an item its runner is advancing keeps its phase (the runner hands it over itself)', async () => {
    const task = await db.task.create({
      data: { title: 'adv', status: 'in-progress', workflowStatus: 'verify' },
    });
    const item = await db.workflowQueueItem.create({
      data: {
        taskId: task.id,
        status: 'running',
        currentPhase: 'advancing',
        startedAt: new Date(),
      },
    });
    expect(await holdForRequiredMerge({ taskId: task.id, fromStatus: 'verify', source: 't' })).toBe(
      true,
    );
    expect((await db.task.findUniqueOrThrow({ where: { id: task.id } })).workflowStatus).toBe(
      'verify_done',
    );
    expect(
      (await db.workflowQueueItem.findUniqueOrThrow({ where: { id: item.id } })).currentPhase,
    ).toBe('advancing');
    expect(await handBackAwaitingCiItems(db as never, task.id, [item.id])).toEqual({
      result: 'lost',
    });
  });
});
