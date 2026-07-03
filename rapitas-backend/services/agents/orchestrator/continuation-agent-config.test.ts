/**
 * continuation-agent-config ユニットテスト
 *
 * buildContinuationAgentConfig() の分岐（dbConfig 有無、apiKey 復号成功/失敗、
 * claudeSessionId 有無、workingDirectory 有無）を検証する。
 *
 * '../agent-factory' は ClaudeCodeAgent 経由で config/database の実 Prisma
 * クライアントを読み込む重い依存チェーンを引き込むため（task-executor.test.ts
 * と同じ理由）モックする。narrowAgentType/isAgentType/AGENT_TYPES は実装と
 * 同じロジックを複製し、他の実エクスポート（AgentFactory/agentFactory）も
 * mock.module のプロセスグローバル性を踏まえてスタブとして残す。
 * secret-store/encryption は純粋なローカル暗号化ロジックのため実装をそのまま使う。
 */
import { describe, expect, test, mock } from 'bun:test';

const AGENT_TYPES = ['claude-code', 'codex', 'gemini', 'custom'] as const;

function narrowAgentType(
  s: string | null | undefined,
  fallback: (typeof AGENT_TYPES)[number] = 'claude-code',
): (typeof AGENT_TYPES)[number] {
  return (AGENT_TYPES as readonly string[]).includes(s ?? '')
    ? (s as (typeof AGENT_TYPES)[number])
    : fallback;
}

function isAgentType(s: unknown): boolean {
  return typeof s === 'string' && (AGENT_TYPES as readonly string[]).includes(s);
}

class AgentFactory {
  static getInstance() {
    return { createAgent: mock(() => ({})), removeAgent: mock(async () => true) };
  }
}

mock.module('../agent-factory', () => ({
  AGENT_TYPES,
  isAgentType,
  narrowAgentType,
  AgentFactory,
  agentFactory: AgentFactory.getInstance(),
}));

const { buildContinuationAgentConfig } = await import('./continuation-agent-config');
const { encrypt } = await import('../../../utils/common/encryption');

import type { ExecutionForConfig, DbAgentConfig } from './continuation-agent-config';

/** テスト用の最小 ExecutionForConfig を構築する */
function makeExecution(overrides: Partial<ExecutionForConfig> = {}): ExecutionForConfig {
  return {
    agentConfigId: null,
    claudeSessionId: null,
    session: { config: { task: { workingDirectory: '/work/dir' } } },
    ...overrides,
  };
}

/** テスト用の最小 DbAgentConfig を構築する */
function makeDbConfig(overrides: Partial<DbAgentConfig> = {}): DbAgentConfig {
  return {
    id: 1,
    agentType: 'codex',
    name: 'My Custom Agent',
    endpoint: 'https://example.test',
    apiKeyEncrypted: null,
    modelId: 'model-x',
    ...overrides,
  };
}

describe('buildContinuationAgentConfig', () => {
  test('dbConfig が無い場合、既定の claude-code フォールバック設定を返す', () => {
    const result = buildContinuationAgentConfig(makeExecution(), {});

    expect(result).toMatchObject({
      type: 'claude-code',
      name: 'Claude Code Agent',
      workingDirectory: '/work/dir',
      dangerouslySkipPermissions: true,
      resumeSessionId: undefined,
      continueConversation: true,
    });
  });

  test('claudeSessionId がある場合、resumeSessionId が設定され continueConversation は false', () => {
    const result = buildContinuationAgentConfig(
      makeExecution({ claudeSessionId: 'session-123' }),
      {},
    );

    expect(result.resumeSessionId).toBe('session-123');
    expect(result.continueConversation).toBe(false);
  });

  test('workingDirectory 未設定の場合、undefined になる', () => {
    const result = buildContinuationAgentConfig(
      makeExecution({ session: { config: { task: { workingDirectory: null } } } }),
      {},
    );

    expect(result.workingDirectory).toBeUndefined();
  });

  test('session.config.task が無い場合でも例外を投げない', () => {
    const result = buildContinuationAgentConfig(makeExecution({ session: { config: null } }), {});

    expect(result.workingDirectory).toBeUndefined();
  });

  test('options.timeout がそのまま反映される', () => {
    const result = buildContinuationAgentConfig(makeExecution(), { timeout: 60000 });
    expect(result.timeout).toBe(60000);
  });

  test('dbConfig がある場合、DB の値から設定を構築する（apiKeyEncrypted 無し）', () => {
    const result = buildContinuationAgentConfig(makeExecution(), {}, makeDbConfig());

    expect(result).toMatchObject({
      type: 'codex',
      name: 'My Custom Agent',
      endpoint: 'https://example.test',
      apiKey: undefined,
      modelId: 'model-x',
      yoloMode: true,
      dangerouslySkipPermissions: true,
    });
  });

  test('dbConfig.agentType が不正な場合、既定の claude-code にフォールバックする', () => {
    const result = buildContinuationAgentConfig(
      makeExecution(),
      {},
      makeDbConfig({ agentType: 'not-a-real-agent-type' }),
    );

    expect(result.type).toBe('claude-code');
  });

  test('dbConfig.endpoint / modelId が null の場合、undefined になる', () => {
    const result = buildContinuationAgentConfig(
      makeExecution(),
      {},
      makeDbConfig({ endpoint: null, modelId: null }),
    );

    expect(result.endpoint).toBeUndefined();
    expect(result.modelId).toBeUndefined();
  });

  test('apiKeyEncrypted が有効な暗号文の場合、正しく復号される', () => {
    const ciphertext = encrypt('super-secret-api-key');
    const result = buildContinuationAgentConfig(
      makeExecution(),
      {},
      makeDbConfig({ apiKeyEncrypted: ciphertext }),
    );

    expect(result.apiKey).toBe('super-secret-api-key');
  });

  test('apiKeyEncrypted の復号に失敗しても例外を投げず apiKey は undefined になる', () => {
    const result = buildContinuationAgentConfig(
      makeExecution(),
      {},
      makeDbConfig({ apiKeyEncrypted: 'not-a-valid-ciphertext-format' }),
    );

    expect(result.apiKey).toBeUndefined();
  });
});
