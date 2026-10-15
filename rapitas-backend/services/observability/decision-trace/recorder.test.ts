/**
 * recorder.test.ts
 *
 * Unit tests for recordDecision: lite/full staging, test/kill-switch guards,
 * masking-before-persist, field truncation, and DB-failure non-propagation.
 * prisma is stubbed via mock.module (process-global — this file must run in
 * isolation, which the file-scoped verify gate guarantees).
 */
import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test';

const mockCreate = mock(() => Promise.resolve({ id: 1 })) as ReturnType<typeof mock>;

mock.module('../../../config/database', () => ({
  prisma: {
    agentDecisionTrace: { create: mockCreate },
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

const { recordDecision } = await import('./recorder');

const baseInput = {
  taskId: 42,
  nodeKey: 'task42:model-route:1',
  kind: 'param_select' as const,
  summary: 'モデル選択: sonnet',
  adoptedId: 'sonnet',
  adoptedReason: '複雑度50（中）に基づきstandardモデルを推奨',
};

const originalNodeEnv = process.env.NODE_ENV;

beforeEach(() => {
  mockCreate.mockReset();
  mockCreate.mockResolvedValue({ id: 1 });
  // The recorder skips writes under NODE_ENV=test; opt into the write path.
  process.env.NODE_ENV = 'development';
  delete process.env.RAPITAS_DECISION_AUDIT;
});

afterEach(() => {
  process.env.NODE_ENV = originalNodeEnv;
  delete process.env.RAPITAS_DECISION_AUDIT;
});

describe('recordDecision guards', () => {
  it('skips writes under NODE_ENV=test', async () => {
    process.env.NODE_ENV = 'test';
    await recordDecision({ ...baseInput, candidates: [] });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('skips writes when RAPITAS_DECISION_AUDIT=off', async () => {
    process.env.RAPITAS_DECISION_AUDIT = 'off';
    await recordDecision({ ...baseInput, candidates: [] });
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

describe('recordDecision staging', () => {
  it('records stage=lite with empty candidate payloads for <=1 candidate', async () => {
    await recordDecision({
      ...baseInput,
      candidates: [{ id: 'sonnet', label: 'standard' }],
      rejectedReasons: { other: 'ignored in lite' },
    });
    expect(mockCreate).toHaveBeenCalledTimes(1);
    const data = (mockCreate.mock.calls[0] as unknown[])[0] as { data: Record<string, unknown> };
    expect(data.data.stage).toBe('lite');
    expect(data.data.candidatesMasked).toBe('[]');
    expect(data.data.rejectedReasons).toBe('{}');
  });

  it('records stage=full with top-5 candidates for >=2 candidates', async () => {
    const candidates = Array.from({ length: 7 }, (_, i) => ({
      id: `model-${i}`,
      label: `候補${i}`,
    }));
    await recordDecision({
      ...baseInput,
      candidates,
      rejectedReasons: { 'model-1': '高コスト', 'model-6': 'トリム対象' },
    });
    const data = (mockCreate.mock.calls[0] as unknown[])[0] as { data: Record<string, unknown> };
    expect(data.data.stage).toBe('full');
    const persisted = JSON.parse(data.data.candidatesMasked as string) as Array<{ id: string }>;
    expect(persisted).toHaveLength(5);
    expect(persisted[0].id).toBe('model-0');
    const rejected = JSON.parse(data.data.rejectedReasons as string) as Record<string, string>;
    expect(rejected['model-1']).toBe('高コスト');
    // Reasons for trimmed candidates are dropped with them.
    expect(rejected['model-6']).toBeUndefined();
  });
});

describe('recordDecision masking and truncation', () => {
  it('masks sensitive input and candidate meta before persisting', async () => {
    await recordDecision({
      ...baseInput,
      input: { apiKey: 'super-secret', complexity: 50 },
      candidates: [
        { id: 'a', label: 'A', meta: { token: 'raw-token' } },
        { id: 'b', label: 'B' },
      ],
    });
    const data = (mockCreate.mock.calls[0] as unknown[])[0] as { data: Record<string, unknown> };
    expect(data.data.inputMasked as string).not.toContain('super-secret');
    expect(data.data.inputMasked as string).toContain('[REDACTED]');
    expect(data.data.candidatesMasked as string).not.toContain('raw-token');
  });

  it('truncates oversized serialized fields with a marker', async () => {
    await recordDecision({
      ...baseInput,
      input: { blob: 'x'.repeat(5000) },
      candidates: [],
    });
    const data = (mockCreate.mock.calls[0] as unknown[])[0] as { data: Record<string, unknown> };
    const inputMasked = data.data.inputMasked as string;
    expect(inputMasked.length).toBeLessThanOrEqual(2048 + '…[truncated]'.length);
    expect(inputMasked.endsWith('…[truncated]')).toBe(true);
  });
});

describe('recordDecision failure isolation', () => {
  it('resolves without throwing when the DB write fails', async () => {
    mockCreate.mockRejectedValueOnce(new Error('DB down'));
    await expect(recordDecision({ ...baseInput, candidates: [] })).resolves.toBeUndefined();
  });

  it('resolves without throwing when the delegate is missing (pre-restart client)', async () => {
    mockCreate.mockImplementationOnce(() => {
      throw new TypeError('prisma.agentDecisionTrace is undefined');
    });
    await expect(recordDecision({ ...baseInput, candidates: [] })).resolves.toBeUndefined();
  });
});
