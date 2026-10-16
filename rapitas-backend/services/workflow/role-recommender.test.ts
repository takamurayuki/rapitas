/**
 * role-recommender テスト
 *
 * recommendAgentForRole's scoring/sort/tie-break chain: highest score wins,
 * ties broken by isDefault then ascending id, a non-positive best score
 * returns null, an empty/failed agent fetch returns null, and the reason
 * string's score-band wording.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

mock.module('../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}));

type AgentRow = { id: number; agentType: string; name: string; isDefault: boolean };

let agents: AgentRow[] = [];
let findManyThrows = false;

mock.module('../../config/database', () => ({
  prisma: {
    aIAgentConfig: {
      findMany: () =>
        findManyThrows ? Promise.reject(new Error('db down')) : Promise.resolve(agents),
    },
  },
}));

// Deterministic score table keyed by agentType, independent of the real
// capability registry — isolates role-recommender's own sort/tie-break logic.
let scoreTable: Record<string, number> = {};
mock.module('../agents/capabilities/agent-capabilities', () => ({
  scoreAgentForRole: (agentType: string) => scoreTable[agentType] ?? 0,
  getCapability: (agentType: string) => ({ type: agentType, notes: `notes for ${agentType}` }),
}));

const { recommendAgentForRole } = await import('./role-recommender');

beforeEach(() => {
  agents = [];
  scoreTable = {};
  findManyThrows = false;
});

describe('recommendAgentForRole', () => {
  test('no installed agents → null', async () => {
    agents = [];
    expect(await recommendAgentForRole('researcher')).toBeNull();
  });

  test('a failed DB fetch is caught and treated as an empty agent list → null', async () => {
    findManyThrows = true;
    expect(await recommendAgentForRole('researcher')).toBeNull();
  });

  test('picks the highest-scoring agent', async () => {
    agents = [
      { id: 1, agentType: 'gemini-cli', name: 'Gemini', isDefault: false },
      { id: 2, agentType: 'claude-code', name: 'Claude', isDefault: false },
    ];
    scoreTable = { 'gemini-cli': 40, 'claude-code': 90 };
    const r = await recommendAgentForRole('researcher');
    expect(r?.agentConfigId).toBe(2);
    expect(r?.score).toBe(90);
  });

  test('a tie in score is broken by isDefault (default agent wins)', async () => {
    agents = [
      { id: 1, agentType: 'claude-code', name: 'Claude', isDefault: false },
      { id: 2, agentType: 'gemini-cli', name: 'Gemini', isDefault: true },
    ];
    scoreTable = { 'claude-code': 80, 'gemini-cli': 80 };
    const r = await recommendAgentForRole('researcher');
    expect(r?.agentConfigId).toBe(2);
  });

  test('a tie in score AND isDefault is broken by ascending id', async () => {
    agents = [
      { id: 5, agentType: 'claude-code', name: 'Claude', isDefault: false },
      { id: 3, agentType: 'gemini-cli', name: 'Gemini', isDefault: false },
    ];
    scoreTable = { 'claude-code': 80, 'gemini-cli': 80 };
    const r = await recommendAgentForRole('researcher');
    expect(r?.agentConfigId).toBe(3);
  });

  test('best score of exactly 0 is treated as "no suitable agent" → null', async () => {
    agents = [{ id: 1, agentType: 'codex', name: 'Codex', isDefault: false }];
    scoreTable = { codex: 0 };
    expect(await recommendAgentForRole('planner')).toBeNull();
  });

  test('a negative (avoid-for-role) score is also rejected → null', async () => {
    agents = [{ id: 1, agentType: 'codex', name: 'Codex', isDefault: false }];
    scoreTable = { codex: -100 };
    expect(await recommendAgentForRole('planner')).toBeNull();
  });

  test('reason wording: score >= 80 → "Strong fit"', async () => {
    agents = [{ id: 1, agentType: 'claude-code', name: 'Claude', isDefault: false }];
    scoreTable = { 'claude-code': 85 };
    const r = await recommendAgentForRole('researcher');
    expect(r?.reason).toContain('Strong fit');
  });

  test('reason wording: 50 <= score < 80 → "Acceptable fit"', async () => {
    agents = [{ id: 1, agentType: 'claude-code', name: 'Claude', isDefault: false }];
    scoreTable = { 'claude-code': 60 };
    const r = await recommendAgentForRole('researcher');
    expect(r?.reason).toContain('Acceptable fit');
  });

  test('reason wording: 0 < score < 50 → "Marginal fit"', async () => {
    agents = [{ id: 1, agentType: 'claude-code', name: 'Claude', isDefault: false }];
    scoreTable = { 'claude-code': 10 };
    const r = await recommendAgentForRole('researcher');
    expect(r?.reason).toContain('Marginal fit');
  });
});
