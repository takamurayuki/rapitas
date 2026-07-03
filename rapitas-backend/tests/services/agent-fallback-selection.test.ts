/**
 * agent-fallback — findFallbackAgentConfig / findAgentConfigForProvider テスト
 *
 * Covers the branches NOT exercised by tests/services/agent-fallback.test.ts
 * (which only locks down agentTypeToProvider): the model_unavailable
 * same-provider retry path, the cooldown + cross-provider fallback pick,
 * "no alternative available" exhaustion, and findAgentConfigForProvider's
 * cooldown short-circuit + excludeConfigId skip.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

mock.module('../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}));

type AgentRow = {
  id: number;
  agentType: string;
  name: string;
  apiKeyEncrypted: string | null;
  endpoint: string | null;
  modelId: string | null;
};

let candidates: AgentRow[] = [];

mock.module('../../config/database', () => ({
  prisma: {
    aIAgentConfig: {
      // findAgentConfigForProvider filters server-side via `where.agentType.in`;
      // findFallbackAgentConfig fetches all active configs unfiltered. Mirror
      // that so the two callers exercise realistic result sets.
      findMany: (args?: { where?: { agentType?: { in?: string[] } } }) => {
        const allowed = args?.where?.agentType?.in;
        const rows = allowed ? candidates.filter((c) => allowed.includes(c.agentType)) : candidates;
        return Promise.resolve(rows);
      },
    },
  },
}));

let classifiedResult: {
  reason: string;
  provider: string;
  resetAt?: Date;
  retryWithFallback: boolean;
  rawMessage: string;
} | null = null;

mock.module('../../services/ai/agent-error-classifier', () => ({
  classifyAgentError: () => classifiedResult,
}));

let cooldownProviders = new Set<string>();
const markCooldownCalls: Array<[string, string, Date | undefined]> = [];

mock.module('../../services/ai/provider-cooldown', () => ({
  isProviderInCooldown: (p: string) => cooldownProviders.has(p),
  markProviderCooldown: (provider: string, reason: string, resetAt: Date | undefined) => {
    markCooldownCalls.push([provider, reason, resetAt]);
  },
}));

const { findFallbackAgentConfig, findAgentConfigForProvider } =
  await import('../../services/ai/agent-fallback');

beforeEach(() => {
  candidates = [];
  classifiedResult = null;
  cooldownProviders = new Set();
  markCooldownCalls.length = 0;
});

function agent(id: number, agentType: string): AgentRow {
  return {
    id,
    agentType,
    name: `agent-${id}`,
    apiKeyEncrypted: null,
    endpoint: null,
    modelId: 'x',
  };
}

describe('findFallbackAgentConfig', () => {
  test('empty error blob → null without classifying', async () => {
    expect(await findFallbackAgentConfig('   ', 'claude-code')).toBeNull();
  });

  test('classifier returning null (unrecognized error) → null', async () => {
    classifiedResult = null;
    const r = await findFallbackAgentConfig('some weird error', 'claude-code');
    expect(r).toBeNull();
  });

  test('classified but retryWithFallback=false → null (no retry attempted)', async () => {
    classifiedResult = {
      reason: 'transient',
      provider: 'claude',
      retryWithFallback: false,
      rawMessage: 'transient hiccup',
    };
    const r = await findFallbackAgentConfig('transient hiccup', 'claude-code');
    expect(r).toBeNull();
  });

  test('model_unavailable: retries with the SAME provider, clearing modelId, and does NOT cooldown', async () => {
    classifiedResult = {
      reason: 'model_unavailable',
      provider: 'claude',
      retryWithFallback: true,
      rawMessage: 'model overloaded',
    };
    candidates = [agent(1, 'gemini-cli'), agent(2, 'claude-code')];
    const r = await findFallbackAgentConfig('model overloaded', 'claude-code');
    expect(r?.agentConfig.id).toBe(2);
    expect(r?.agentConfig.modelId).toBeNull();
    expect(markCooldownCalls).toHaveLength(0);
  });

  test('model_unavailable with no same-provider candidate available → null', async () => {
    classifiedResult = {
      reason: 'model_unavailable',
      provider: 'claude',
      retryWithFallback: true,
      rawMessage: 'model overloaded',
    };
    candidates = [agent(1, 'gemini-cli')];
    const r = await findFallbackAgentConfig('model overloaded', 'claude-code');
    expect(r).toBeNull();
  });

  test('quota/rate_limit: marks the failed provider in cooldown and picks a different-provider candidate', async () => {
    classifiedResult = {
      reason: 'quota',
      provider: 'claude',
      retryWithFallback: true,
      rawMessage: 'credit balance too low',
    };
    candidates = [agent(1, 'claude-code'), agent(2, 'codex')];
    const r = await findFallbackAgentConfig('credit balance too low', 'claude-code');
    expect(r?.agentConfig.id).toBe(2);
    expect(markCooldownCalls).toHaveLength(1);
    expect(markCooldownCalls[0][0]).toBe('claude');
  });

  test('a candidate whose provider is itself in cooldown is skipped', async () => {
    classifiedResult = {
      reason: 'quota',
      provider: 'claude',
      retryWithFallback: true,
      rawMessage: 'quota exceeded',
    };
    cooldownProviders = new Set(['openai']);
    candidates = [agent(1, 'codex'), agent(2, 'gemini-cli')];
    const r = await findFallbackAgentConfig('quota exceeded', 'claude-code');
    expect(r?.agentConfig.id).toBe(2); // codex (openai) skipped, gemini-cli chosen
  });

  test('no alternative-provider candidate exists at all → null', async () => {
    classifiedResult = {
      reason: 'quota',
      provider: 'claude',
      retryWithFallback: true,
      rawMessage: 'quota exceeded',
    };
    candidates = [agent(1, 'claude-code'), agent(2, 'anthropic-api')]; // both claude family
    const r = await findFallbackAgentConfig('quota exceeded', 'claude-code');
    expect(r).toBeNull();
  });

  test('a candidate with an unrecognized agentType (provider=null) is skipped, not crashed on', async () => {
    classifiedResult = {
      reason: 'quota',
      provider: 'claude',
      retryWithFallback: true,
      rawMessage: 'quota exceeded',
    };
    candidates = [agent(1, 'mystery-agent'), agent(2, 'codex')];
    const r = await findFallbackAgentConfig('quota exceeded', 'claude-code');
    expect(r?.agentConfig.id).toBe(2);
  });
});

describe('findAgentConfigForProvider', () => {
  test('provider already in cooldown → null without querying candidates', async () => {
    cooldownProviders = new Set(['openai']);
    candidates = [agent(1, 'codex')];
    expect(await findAgentConfigForProvider('openai')).toBeNull();
  });

  test('returns the first matching candidate when none is excluded', async () => {
    candidates = [agent(1, 'codex'), agent(2, 'chatgpt')];
    const r = await findAgentConfigForProvider('openai');
    expect(r?.id).toBe(1);
  });

  test('excludeConfigId skips that specific candidate, falling to the next', async () => {
    candidates = [agent(1, 'codex'), agent(2, 'chatgpt')];
    const r = await findAgentConfigForProvider('openai', { excludeConfigId: 1 });
    expect(r?.id).toBe(2);
  });

  test('no candidates for the provider → null', async () => {
    candidates = [agent(1, 'gemini-cli')];
    expect(await findAgentConfigForProvider('openai')).toBeNull();
  });
});
