/**
 * model-provider-alignment テスト
 *
 * The executor agent must be able to run the model the router chose: switch
 * to a compatible agent, or drop a model the current agent cannot run.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const noop = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
mock.module('../../../../config/logger', () => ({ createLogger: () => noop, logger: noop }));
let currentAgent: { id: number; agentType: string; name: string } | null = null;
let findThrows = false;
mock.module('../../../../config/database', () => ({
  prisma: {
    aIAgentConfig: {
      findUnique: async () => {
        if (findThrows) throw new Error('db down');
        return currentAgent;
      },
    },
  },
}));
let compatible: { id: number; name: string; agentType: string } | null = null;
const findAgentConfigForProvider = mock(async (..._a: unknown[]) => compatible);
mock.module('../../../../services/ai/agent-fallback', () => ({
  agentTypeToProvider: (t: string | null | undefined) =>
    t === 'claude-code' ? 'claude' : t === 'codex' ? 'openai' : null,
  findAgentConfigForProvider,
}));
mock.module('../../../../services/workflow/role-provider-resolver', () => ({
  inferProviderFromModelId: (m: string) =>
    m.startsWith('gpt-') ? 'openai' : m.startsWith('claude') ? 'claude' : null,
}));

const { alignAgentWithModelProvider } = await import('./model-provider-alignment');

const align = (modelId: string) =>
  alignAgentWithModelProvider({ taskId: 1, role: 'implementer', agentConfigId: 10, modelId });

beforeEach(() => {
  currentAgent = { id: 10, agentType: 'claude-code', name: 'Claude' };
  compatible = null;
  findThrows = false;
  findAgentConfigForProvider.mockClear();
});

describe('alignAgentWithModelProvider', () => {
  test('同じプロバイダのモデルならそのまま', async () => {
    expect(await align('claude-sonnet')).toEqual({ agentConfigId: 10, modelId: 'claude-sonnet' });
    expect(findAgentConfigForProvider).not.toHaveBeenCalled();
  });

  test('別プロバイダのモデルなら、対応するエージェントへ切り替える', async () => {
    compatible = { id: 20, name: 'Codex', agentType: 'codex' };
    expect(await align('gpt-5')).toEqual({ agentConfigId: 20, modelId: 'gpt-5' });
    expect(findAgentConfigForProvider).toHaveBeenCalledWith('openai', { excludeConfigId: 10 });
  });

  test('対応するエージェントが無ければ、モデル指定を捨てて既定モデルで動かす', async () => {
    expect(await align('gpt-5')).toEqual({ agentConfigId: 10, modelId: undefined });
  });

  test('系統を推定できないモデルは、今のエージェントの系統に見えるときだけ残す', async () => {
    expect(await align('opus-next')).toEqual({ agentConfigId: 10, modelId: 'opus-next' });
    expect(await align('mystery-model')).toEqual({ agentConfigId: 10, modelId: undefined });
  });

  test('照会に失敗したら、変更せずにそのまま返す', async () => {
    findThrows = true;
    expect(await align('gpt-5')).toEqual({ agentConfigId: 10, modelId: 'gpt-5' });
  });
});
