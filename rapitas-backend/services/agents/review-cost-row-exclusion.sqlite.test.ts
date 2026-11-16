/**
 * review-cost-row-exclusion.sqlite.test
 *
 * The jury records its spend as an AgentExecution (command=adversarial-review)
 * AFTER the run it judged, in the same session. Every "latest run" read must
 * still return the run. Each case inserts a real run, then a cost row, into a
 * real SQLite database (production init SQL) and checks what the read returns
 * — not the shape of a filter constant (G2 review item 2).
 */
import { afterAll, beforeEach, describe, expect, mock, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '../../generated/prisma-sqlite';
import { SQLITE_INIT_SQL } from '../../src/generated/sqlite-init-sql';
import { REVIEW_COST_COMMAND } from './review-cost-rows';

const dir = mkdtempSync(join(tmpdir(), 'rapitas-cost-row-'));
const dbPath = join(dir, 'test.db');
const init = new Database(dbPath);
init.exec(SQLITE_INIT_SQL);
init.close();
const db = new PrismaClient({ datasources: { db: { url: `file:${dbPath}` } } });
const createLogger = () => ({ info() {}, warn() {}, error() {}, debug() {} });
mock.module('../../config', () => ({ prisma: db, createLogger }));
mock.module('../../config/database', () => ({ prisma: db }));
mock.module('../../config/logger', () => ({ createLogger }));

const { taskExecutionLogsRouter } =
  await import('../../routes/agents/monitoring/agent-audit-router');
const { findCompletionEventExecution } =
  await import('../workflow/workflow-cli-executor-postprocess');
const { findReasoningTraceExecutionId } =
  await import('../../routes/workflow/handlers/file-save/verify-commit-pr-side-effects');
const { findOutcomeModel } = await import('../workflow/outcome-telemetry');

afterAll(async () => {
  await db.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

const t = (ms: number) => new Date(1_700_000_000_000 + ms);
let taskId = 0;
let sessionId = 0;
let runId = 0;
let costRowId = 0;

beforeEach(async () => {
  await db.agentExecutionLog.deleteMany();
  await db.agentExecution.deleteMany();
  await db.agentSession.deleteMany();
  await db.developerModeConfig.deleteMany();
  await db.aIAgentConfig.deleteMany();
  await db.task.deleteMany();
  taskId = (await db.task.create({ data: { title: 'task' } })).id;
  const configId = (await db.developerModeConfig.create({ data: { taskId } })).id;
  sessionId = (await db.agentSession.create({ data: { configId } })).id;
  const agent = await db.aIAgentConfig.create({ data: { agentType: 'claude-code', name: 'c' } });
  const run = await db.agentExecution.create({
    data: {
      sessionId,
      agentConfigId: agent.id,
      command: 'execute',
      status: 'completed',
      output: 'run output',
      modelName: 'claude-opus-implementer',
      startedAt: t(0),
      completedAt: t(100),
      createdAt: t(0),
    },
  });
  runId = run.id;
  await db.agentExecutionLog.createMany({
    data: [1, 2, 3].map((n) => ({ executionId: run.id, logChunk: `line ${n}`, sequenceNumber: n })),
  });
  // The jury's cost row: newer, completed, no logs, no agentConfig, juror model.
  costRowId = (
    await db.agentExecution.create({
      data: {
        sessionId,
        command: REVIEW_COST_COMMAND,
        status: 'completed',
        output: '{"kind":"adversarial-review"}',
        modelName: 'claude-sonnet-juror',
        costUsd: 0.01,
        startedAt: t(200),
        completedAt: t(300),
        createdAt: t(200),
      },
    })
  ).id;
});

describe('latest-run reads with a jury cost row inserted after the run', () => {
  test('GET /tasks/:id/execution-logs?afterSequence (single-execution mode) returns the run', async () => {
    const res = await taskExecutionLogsRouter.handle(
      new Request(`http://localhost/tasks/${taskId}/execution-logs?afterSequence=1`),
    );
    const body = (await res.json()) as {
      executionId: number;
      status: string;
      output?: string;
      logs: unknown[];
    };
    expect(body.executionId).toBe(runId);
    // The run's logs after sequence 1 — the cost row has none.
    expect(body.logs).toHaveLength(2);
  });

  test('execution-logs with an explicit executionId still returns that row', async () => {
    const res = await taskExecutionLogsRouter.handle(
      new Request(`http://localhost/tasks/${taskId}/execution-logs?executionId=${costRowId}`),
    );
    expect(((await res.json()) as { executionId: number }).executionId).toBe(costRowId);
  });

  test('the deferred agent_execution_completed event names the run and its agent', async () => {
    const exec = await findCompletionEventExecution(sessionId);
    expect(exec?.id).toBe(runId);
    expect(exec?.agentConfig?.agentType).toBe('claude-code');
  });

  test('the reasoning trace is recorded for the run, not the cost row', async () => {
    expect(await findReasoningTraceExecutionId(taskId)).toBe(runId);
  });

  test('the task outcome is credited to the implementer model, not the juror', async () => {
    expect(await findOutcomeModel(taskId)).toBe('claude-opus-implementer');
  });
});
