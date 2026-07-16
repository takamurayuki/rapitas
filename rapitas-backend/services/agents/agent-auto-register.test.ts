/**
 * agent-auto-register ユニットテスト
 *
 * autoRegisterAvailableAgents の登録/再有効化/スキップ判定と、
 * デフォルトエージェント選定（Claude Code優先・既存デフォルト温存）を
 * prisma と discoverModels をモックして検証する。
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

interface FakeRow {
  id: number;
  agentType: string;
  name: string;
  modelId: string | null;
  isActive: boolean;
  isInstalled: boolean;
  isDefault: boolean;
}

let rows: FakeRow[];
let nextId: number;

const findFirst = mock(({ where }: { where: { agentType: string } }) =>
  Promise.resolve(rows.find((r) => r.agentType === where.agentType) ?? null),
);
const create = mock(({ data }: { data: Partial<FakeRow> }) => {
  const row: FakeRow = {
    id: nextId++,
    agentType: data.agentType!,
    name: data.name!,
    modelId: data.modelId ?? null,
    isActive: true,
    isInstalled: true,
    isDefault: false,
  };
  rows.push(row);
  return Promise.resolve(row);
});
const update = mock(({ where, data }: { where: { id: number }; data: Partial<FakeRow> }) => {
  const row = rows.find((r) => r.id === where.id)!;
  Object.assign(row, data);
  return Promise.resolve(row);
});
const findMany = mock(({ where }: { where: { isActive: boolean } }) =>
  Promise.resolve(rows.filter((r) => r.isActive === where.isActive)),
);

mock.module('../../config/database', () => ({
  prisma: { aIAgentConfig: { findFirst, create, update, findMany } },
}));

const mockDiscoverModels = mock(() =>
  Promise.resolve({
    fetchedAt: new Date().toISOString(),
    providers: [],
    models: [],
  }),
);
mock.module('../ai/model-discovery', () => ({ discoverModels: mockDiscoverModels }));

const noopLogger = {
  info: () => {},
  error: () => {},
  warn: () => {},
  debug: () => {},
  fatal: () => {},
};
mock.module('../../config/logger', () => ({
  createLogger: () => noopLogger,
  logger: noopLogger,
  getBackendLogFilePath: () => '/tmp/backend.log',
}));

const { autoRegisterAvailableAgents } = await import('./agent-auto-register');

describe('autoRegisterAvailableAgents', () => {
  beforeEach(() => {
    rows = [];
    nextId = 1;
    findFirst.mockClear();
    create.mockClear();
    update.mockClear();
    findMany.mockClear();
  });

  test('registers a new agent config for an available provider', async () => {
    mockDiscoverModels.mockImplementationOnce(() =>
      Promise.resolve({
        fetchedAt: '',
        providers: [{ provider: 'claude', available: true, models: [] }],
        models: [
          { id: 'claude-opus-4-5', provider: 'claude', tier: 'flagship', source: 'cli-alias' },
        ],
      }),
    );
    const result = await autoRegisterAvailableAgents();
    expect(result.registered).toHaveLength(1);
    expect(result.registered[0].agentType).toBe('claude-code');
    expect(result.registered[0].modelId).toBe('claude-opus-4-5');
    expect(result.skipped).toEqual([]);
  });

  test('skips an unavailable provider with its reason', async () => {
    mockDiscoverModels.mockImplementationOnce(() =>
      Promise.resolve({
        fetchedAt: '',
        providers: [
          { provider: 'gemini', available: false, reason: 'CLI not installed', models: [] },
        ],
        models: [],
      }),
    );
    const result = await autoRegisterAvailableAgents();
    expect(result.registered).toEqual([]);
    expect(result.skipped).toEqual([{ provider: 'gemini', reason: 'CLI not installed' }]);
  });

  test('defaults the skip reason to Japanese "利用不可" when none is given', async () => {
    mockDiscoverModels.mockImplementationOnce(() =>
      Promise.resolve({
        fetchedAt: '',
        providers: [{ provider: 'ollama', available: false, models: [] }],
        models: [],
      }),
    );
    const result = await autoRegisterAvailableAgents();
    expect(result.skipped[0].reason).toBe('利用不可');
  });

  test('ignores a provider with no PROVIDER_AGENT_TYPE mapping', async () => {
    mockDiscoverModels.mockImplementationOnce(() =>
      Promise.resolve({
        fetchedAt: '',
        providers: [{ provider: 'unmapped-provider' as never, available: true, models: [] }],
        models: [],
      }),
    );
    const result = await autoRegisterAvailableAgents();
    expect(result.registered).toEqual([]);
    expect(result.skipped).toEqual([]);
  });

  test('reactivates (not duplicates) an existing agent config row', async () => {
    rows.push({
      id: 5,
      agentType: 'claude-code',
      name: 'Claude Code',
      modelId: null,
      isActive: false,
      isInstalled: false,
      isDefault: false,
    });
    mockDiscoverModels.mockImplementationOnce(() =>
      Promise.resolve({
        fetchedAt: '',
        providers: [{ provider: 'claude', available: true, models: [] }],
        models: [
          { id: 'claude-opus-4-5', provider: 'claude', tier: 'flagship', source: 'cli-alias' },
        ],
      }),
    );
    await autoRegisterAvailableAgents();
    expect(create).not.toHaveBeenCalled();
    expect(rows).toHaveLength(1);
    expect(rows[0].isActive).toBe(true);
    expect(rows[0].modelId).toBe('claude-opus-4-5');
  });

  test('does not clobber an existing explicit modelId on reactivation', async () => {
    rows.push({
      id: 5,
      agentType: 'claude-code',
      name: 'Claude Code',
      modelId: 'user-picked-model',
      isActive: false,
      isInstalled: false,
      isDefault: false,
    });
    mockDiscoverModels.mockImplementationOnce(() =>
      Promise.resolve({
        fetchedAt: '',
        providers: [{ provider: 'claude', available: true, models: [] }],
        models: [
          { id: 'claude-opus-4-5', provider: 'claude', tier: 'flagship', source: 'cli-alias' },
        ],
      }),
    );
    await autoRegisterAvailableAgents();
    expect(rows[0].modelId).toBe('user-picked-model');
  });

  test('marks the sole registered agent as default when none is set', async () => {
    mockDiscoverModels.mockImplementationOnce(() =>
      Promise.resolve({
        fetchedAt: '',
        providers: [{ provider: 'gemini', available: true, models: [] }],
        models: [],
      }),
    );
    const result = await autoRegisterAvailableAgents();
    expect(result.registered[0].isDefault).toBe(true);
  });

  test('prefers claude-code as the default when multiple providers register with no existing default', async () => {
    mockDiscoverModels.mockImplementationOnce(() =>
      Promise.resolve({
        fetchedAt: '',
        providers: [
          { provider: 'gemini', available: true, models: [] },
          { provider: 'claude', available: true, models: [] },
        ],
        models: [],
      }),
    );
    const result = await autoRegisterAvailableAgents();
    const claudeCode = result.registered.find((r) => r.agentType === 'claude-code');
    const gemini = result.registered.find((r) => r.agentType === 'gemini-cli');
    expect(claudeCode?.isDefault).toBe(true);
    expect(gemini?.isDefault).toBe(false);
  });

  test('leaves an existing default agent untouched (does not reassign default)', async () => {
    rows.push({
      id: 5,
      agentType: 'gemini-cli',
      name: 'Gemini CLI',
      modelId: null,
      isActive: true,
      isInstalled: true,
      isDefault: true,
    });
    mockDiscoverModels.mockImplementationOnce(() =>
      Promise.resolve({
        fetchedAt: '',
        providers: [{ provider: 'claude', available: true, models: [] }],
        models: [],
      }),
    );
    const result = await autoRegisterAvailableAgents();
    const claudeCode = result.registered.find((r) => r.agentType === 'claude-code');
    expect(claudeCode?.isDefault).toBe(false);
    expect(rows.find((r) => r.agentType === 'gemini-cli')?.isDefault).toBe(true);
  });
});
