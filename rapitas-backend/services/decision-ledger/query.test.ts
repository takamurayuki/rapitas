/**
 * decision-ledger/query.test
 *
 * Covers the merge across the three sources: newest-first ordering, kind
 * filtering that skips whole sources, and the rule that one unreadable source
 * degrades the ledger instead of failing the read.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const noopLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
const traceFind = mock((): Promise<unknown[]> => Promise.resolve([]));
const recordFind = mock((): Promise<unknown[]> => Promise.resolve([]));
const logFind = mock((): Promise<unknown[]> => Promise.resolve([]));

mock.module('../../config/database', () => ({
  prisma: {
    agentDecisionTrace: { findMany: traceFind },
    workflowLearningRecord: { findMany: recordFind },
    decisionLog: { findMany: logFind },
  },
  ensureDatabaseConnection: () => Promise.resolve(),
}));
mock.module('../../config/logger', () => ({
  createLogger: () => noopLogger,
  logger: noopLogger,
  getBackendLogFilePath: () => '/tmp/backend.log',
}));

const { readDecisions } = await import('./query');

const TRACE = {
  id: 480,
  taskId: 666,
  nodeKey: 'task666:model-route:1',
  summary: 'モデル選択',
  adoptedId: 'claude-sonnet-5',
  adoptedReason: 'reason',
  consistency: 'consistent',
  consistencyNote: null,
  createdAt: new Date('2026-08-25T15:00:00Z'),
};
const RECORD = {
  id: 2750,
  taskId: 666,
  workflowMode: 'standard',
  predictedComplexity: 40,
  estimatedDuration: 76,
  actualDurationMinutes: 60,
  outcome: 'completed',
  success: true,
  createdAt: new Date('2026-08-25T16:00:00Z'),
};
const LOG = {
  id: 12,
  taskId: 666,
  decision: '計画を承認',
  context: 'ctx',
  rationale: null,
  predictedOutcome: 'ok',
  confidence: 0.7,
  actualOutcome: null,
  calibration: 'pending',
  createdAt: new Date('2026-08-25T14:00:00Z'),
};

describe('readDecisions', () => {
  beforeEach(() => {
    traceFind.mockReset().mockResolvedValue([TRACE]);
    recordFind.mockReset().mockResolvedValue([RECORD]);
    logFind.mockReset().mockResolvedValue([LOG]);
  });

  test('merges all three sources newest first', async () => {
    const out = await readDecisions();
    expect(out.map((d) => d.source)).toEqual(['learning_record', 'decision_trace', 'decision_log']);
  });

  test('a kind filter skips the sources that cannot supply it', async () => {
    const out = await readDecisions({ kinds: ['workflow_mode'] });

    expect(out.map((d) => d.kind)).toEqual(['workflow_mode']);
    expect(traceFind).not.toHaveBeenCalled();
    expect(logFind).not.toHaveBeenCalled();
  });

  test('one unreadable source degrades the ledger instead of failing the read', async () => {
    traceFind.mockRejectedValue(new Error('table missing'));

    const out = await readDecisions();

    expect(out.map((d) => d.source)).toEqual(['learning_record', 'decision_log']);
  });

  test('narrows by task and time at the database, not in memory', async () => {
    const since = new Date('2026-08-01T00:00:00Z');
    await readDecisions({ taskId: 666, since, limit: 10 });

    const arg = traceFind.mock.calls[0]?.[0] as {
      where: { taskId: number; createdAt: { gte: Date } };
      take: number;
    };
    expect(arg.where.taskId).toBe(666);
    expect(arg.where.createdAt.gte).toEqual(since);
    expect(arg.take).toBe(10);
  });
});
