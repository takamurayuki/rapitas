/**
 * consistency-checker.test.ts
 *
 * Unit tests for judgeConsistency (pure verdict logic) and
 * runConsistencyCheckBatch (pending-row processing, skip rules, DB-failure
 * tolerance). prisma is stubbed via mock.module.
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test';

const mockTraceFindMany = mock(() => Promise.resolve([])) as ReturnType<typeof mock>;
const mockTraceUpdate = mock(() => Promise.resolve({})) as ReturnType<typeof mock>;
const mockTraceUpdateMany = mock(() => Promise.resolve({ count: 0 })) as ReturnType<typeof mock>;
const mockExecutionFindMany = mock(() => Promise.resolve([])) as ReturnType<typeof mock>;

mock.module('../../../config/database', () => ({
  prisma: {
    agentDecisionTrace: {
      findMany: mockTraceFindMany,
      update: mockTraceUpdate,
      updateMany: mockTraceUpdateMany,
    },
    agentExecution: { findMany: mockExecutionFindMany },
  },
  ensureDatabaseConnection: () => Promise.resolve(),
}));

mock.module('../../../config/logger', () => {
  const noopLogger = {
    info: () => {},
    error: () => {},
    warn: () => {},
    debug: () => {},
    fatal: () => {},
  };
  return {
    createLogger: () => noopLogger,
    logger: noopLogger,
    getBackendLogFilePath: () => '/tmp/backend.log',
  };
});

const { judgeConsistency, runConsistencyCheckBatch } = await import('./consistency-checker');

/** Minimal pending-row factory — only the fields the checker reads. */
function pendingRow(id: number, executionId: number | null, adoptedReason = '理由'): Record<string, unknown> {
  return { id, executionId, adoptedReason, rejectedReasons: '{}', consistency: 'pending' };
}

beforeEach(() => {
  for (const m of [mockTraceFindMany, mockTraceUpdate, mockTraceUpdateMany, mockExecutionFindMany]) {
    m.mockReset();
  }
  mockTraceFindMany.mockResolvedValue([]);
  mockTraceUpdate.mockResolvedValue({});
  mockTraceUpdateMany.mockResolvedValue({ count: 0 });
  mockExecutionFindMany.mockResolvedValue([]);
});

describe('judgeConsistency', () => {
  const decision = { adoptedReason: '複雑度が低いためeconomyで十分', rejectedReasons: '{}' };

  it('completed → consistent', () => {
    const v = judgeConsistency({ status: 'completed', errorMessage: null }, decision);
    expect(v.consistency).toBe('consistent');
    expect(v.note).toBe('実行が正常完了');
  });

  it('failed with risk-aware reasoning → consistent', () => {
    const v = judgeConsistency(
      { status: 'failed', errorMessage: 'boom' },
      { adoptedReason: '失敗する可能性はあるが低コストを優先', rejectedReasons: '{}' },
    );
    expect(v.consistency).toBe('consistent');
    expect(v.note).toBe('想定されたリスクの範囲内での失敗');
  });

  it('failed with risk wording only in rejectedReasons → consistent', () => {
    const v = judgeConsistency(
      { status: 'failed', errorMessage: 'boom' },
      { adoptedReason: '最適なため', rejectedReasons: '{"b":"フォールバック用に温存"}' },
    );
    expect(v.consistency).toBe('consistent');
  });

  it('failed without risk-aware reasoning → inconsistent', () => {
    const v = judgeConsistency({ status: 'failed', errorMessage: 'boom' }, decision);
    expect(v.consistency).toBe('inconsistent');
    expect(v.note).toContain('乖離');
  });

  it('blocked → skipped', () => {
    const v = judgeConsistency({ status: 'blocked', errorMessage: null }, decision);
    expect(v.consistency).toBe('skipped');
  });
});

describe('runConsistencyCheckBatch', () => {
  it('returns zeros when nothing is pending', async () => {
    const result = await runConsistencyCheckBatch();
    expect(result).toEqual({ checked: 0, updated: 0 });
    expect(mockTraceUpdate).not.toHaveBeenCalled();
  });

  it('marks rows without executionId as skipped immediately', async () => {
    mockTraceFindMany.mockResolvedValueOnce([pendingRow(1, null), pendingRow(2, null)]);
    const result = await runConsistencyCheckBatch();
    expect(result).toEqual({ checked: 2, updated: 2 });
    expect(mockTraceUpdateMany).toHaveBeenCalledTimes(1);
    const arg = (mockTraceUpdateMany.mock.calls[0] as unknown[])[0] as {
      where: { id: { in: number[] } };
      data: { consistency: string };
    };
    expect(arg.where.id.in).toEqual([1, 2]);
    expect(arg.data.consistency).toBe('skipped');
  });

  it('applies the verdict for terminal executions and keeps non-terminal pending', async () => {
    mockTraceFindMany.mockResolvedValueOnce([pendingRow(1, 10), pendingRow(2, 11), pendingRow(3, 12)]);
    mockExecutionFindMany.mockResolvedValueOnce([
      { id: 10, status: 'completed', errorMessage: null },
      { id: 11, status: 'running', errorMessage: null },
      { id: 12, status: 'failed', errorMessage: 'x' },
    ]);
    const result = await runConsistencyCheckBatch();
    expect(result).toEqual({ checked: 3, updated: 2 });
    expect(mockTraceUpdate).toHaveBeenCalledTimes(2);
    const first = (mockTraceUpdate.mock.calls[0] as unknown[])[0] as {
      where: { id: number };
      data: { consistency: string; verifiedAt: Date };
    };
    expect(first.where.id).toBe(1);
    expect(first.data.consistency).toBe('consistent');
    expect(first.data.verifiedAt).toBeInstanceOf(Date);
    const second = (mockTraceUpdate.mock.calls[1] as unknown[])[0] as {
      where: { id: number };
      data: { consistency: string };
    };
    expect(second.where.id).toBe(3);
    expect(second.data.consistency).toBe('inconsistent');
  });

  it('keeps rows pending when the execution row is missing', async () => {
    mockTraceFindMany.mockResolvedValueOnce([pendingRow(1, 999)]);
    mockExecutionFindMany.mockResolvedValueOnce([]);
    const result = await runConsistencyCheckBatch();
    expect(result).toEqual({ checked: 1, updated: 0 });
    expect(mockTraceUpdate).not.toHaveBeenCalled();
  });

  it('swallows DB failures and reports zeros (retried next run)', async () => {
    mockTraceFindMany.mockRejectedValueOnce(new Error('DB down'));
    const result = await runConsistencyCheckBatch();
    expect(result).toEqual({ checked: 0, updated: 0 });
  });
});
