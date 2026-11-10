// @ts-nocheck — Loosely-typed mock setup; types are not the concern of this test file.
/**
 * smart-model-router.decision-trace.test.ts
 *
 * Spy test for the decision-audit instrumentation in getSmartRoute():
 * verifies recordDecision is invoked with kind=param_select, the adopted
 * model, and the alternatives as candidates — without altering the returned
 * RoutingDecision. The decision-trace barrel is stubbed via mock.module
 * (process-global — run this file in isolation).
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test';

const mockRecordDecision = mock(() => Promise.resolve()) as ReturnType<typeof mock>;

// HACK(agent): bun の mock.module はプロセスグローバルなため、バレルの全エクスポートを
// ミラーしないと他 import が "export not found" をスローする。
mock.module('../observability/decision-trace', () => ({
  recordDecision: mockRecordDecision,
  getDecisionDag: () => Promise.resolve({ nodes: [], edges: [] }),
  runConsistencyCheckBatch: () => Promise.resolve({ checked: 0, updated: 0 }),
  judgeConsistency: () => ({ consistency: 'skipped', note: '' }),
  maskSensitive: (v) => ({ masked: v, maskedFieldCount: 0 }),
  maskStringValue: (v) => ({ masked: v, count: 0 }),
}));

const mockTaskFindUnique = mock(() =>
  Promise.resolve({ complexityScore: 50, title: 'テストタスク', priority: 'medium' }),
);

mock.module('../../config/database', () => ({
  prisma: {
    task: {
      findUnique: mockTaskFindUnique,
    },
    agentExecution: { findMany: mock(() => Promise.resolve([])) },
  },
  ensureDatabaseConnection: () => Promise.resolve(),
}));

mock.module('../../config/logger', () => {
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

const mockSelectBestModel = mock(() =>
  Promise.resolve({ model: { id: 'chosen-model', provider: 'claude' }, tier: 'standard' }),
);

mock.module('./model-discovery', () => ({
  discoverModels: mock(() =>
    Promise.resolve({
      models: [
        { id: 'alt-model', provider: 'claude', tier: 'economy', costPer1kTokens: 0.001 },
        { id: 'chosen-model', provider: 'claude', tier: 'standard', costPer1kTokens: 0.01 },
      ],
      providers: [{ provider: 'claude', available: true }],
    }),
  ),
  selectBestModel: mockSelectBestModel,
}));

mock.module('./model-discovery/tier-classifier', () => ({
  classifyTier: mock(() => 'standard'),
  inferCostPer1k: mock(() => 0.01),
}));

mock.module('./provider-cooldown', () => ({
  listActiveCooldowns: mock(() => []),
  markProviderCooldown: mock(() => {}),
  isProviderInCooldown: mock(() => false),
  clearCooldown: mock(() => {}),
  // NOTE: bun mock.module replaces the whole module — new exports must be
  // mirrored here or importers see undefined at runtime.
  recordProviderSuccess: mock(() => {}),
  listFailureStreaks: mock(() => []),
  inferProviderFromModelName: mock(() => null),
  __resetCooldowns: mock(() => {}),
}));

const { getSmartRoute } = await import('./smart-model-router');

beforeEach(() => {
  mockRecordDecision.mockReset();
  mockRecordDecision.mockResolvedValue(undefined);
});

describe('getSmartRoute decision-trace instrumentation', () => {
  it('records a param_select decision with adopted model and alternatives', async () => {
    const route = await getSmartRoute(1, {});

    expect(mockRecordDecision).toHaveBeenCalledTimes(1);
    const input = mockRecordDecision.mock.calls[0][0];
    expect(input.kind).toBe('param_select');
    expect(input.taskId).toBe(1);
    expect(input.nodeKey).toContain('task1:model-route:');
    expect(input.adoptedId).toBe(route.recommendedModel);
    expect(input.adoptedReason).toBe(route.reason);
    // Candidates = adopted first + the alternatives list.
    expect(input.candidates[0].id).toBe(route.recommendedModel);
    expect(input.candidates.length).toBe(1 + route.alternativeModels.length);
    for (const alt of route.alternativeModels) {
      expect(input.rejectedReasons[alt.modelId]).toBe(alt.tradeoff);
    }
  });

  it('records a single candidate (lite path) when alternatives are skipped', async () => {
    const route = await getSmartRoute(2, { includeAlternatives: false });

    expect(route.alternativeModels).toEqual([]);
    expect(mockRecordDecision).toHaveBeenCalledTimes(1);
    const input = mockRecordDecision.mock.calls[0][0];
    expect(input.candidates.length).toBe(1);
    expect(input.candidates[0].id).toBe(route.recommendedModel);
  });

  it('does not change the RoutingDecision shape', async () => {
    const route = await getSmartRoute(3, {});
    expect(route.recommendedModel).toBe('chosen-model');
    expect(route.recommendedTier).toBe('standard');
    expect(typeof route.reason).toBe('string');
    expect(route.costEstimate).toBeDefined();
  });
});

// The same resolver as the workflow-mode selection (complexity-score.ts): a
// missing score is the safe default 50, while an ASSESSED 0 is a real score.
// `complexityScore || 50` used to read 0 as 50 here while the mode selection
// read it as 0 (lightweight).
describe('getSmartRoute complexity resolution', () => {
  const desiredTierFor = async (complexityScore: number | null) => {
    mockTaskFindUnique.mockImplementationOnce(() =>
      Promise.resolve({ complexityScore, title: 't', priority: 'medium' }),
    );
    mockSelectBestModel.mockClear();
    await getSmartRoute(3, { includeAlternatives: false });
    return mockSelectBestModel.mock.calls[0][0].desiredTier;
  };

  it('treats a missing score as the shared default 50 (standard)', async () => {
    expect(await desiredTierFor(null)).toBe('standard');
  });

  it('keeps an assessed 0 as 0 (economy) instead of rewriting it to 50', async () => {
    expect(await desiredTierFor(0)).toBe('economy');
  });
});
