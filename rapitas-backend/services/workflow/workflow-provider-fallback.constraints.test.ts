/**
 * workflow-provider-fallback.constraints.test
 *
 * A vendor going down mid-task (quota / auth) re-assigns the phase through the
 * same role routing as a normal run — role, floors and caps included — with
 * the failed provider excluded (追補5 / 修正リストD). Only when role routing
 * itself cannot answer does it fall back to the bare SmartRouter call, and that
 * degraded path is recorded as such.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const noopLogger = { info: () => {}, error: () => {}, warn: () => {}, debug: () => {} };
mock.module('../../config/logger', () => ({ createLogger: () => noopLogger }));

mock.module('../ai/agent-error-classifier', () => ({
  classifyAgentError: () => ({
    retryWithFallback: true,
    provider: 'openai',
    reason: 'quota',
    rawMessage: "You've hit your usage limit",
  }),
}));
const markProviderCooldown = mock((..._a: unknown[]) => {});
mock.module('../ai/provider-cooldown', () => ({ markProviderCooldown }));
const getSmartRoute = mock((_t: number, _o: unknown) =>
  Promise.resolve({ recommendedModel: 'bare-fallback' }),
);
mock.module('../ai/smart-model-router', () => ({ getSmartRoute }));
mock.module('../ai/agent-fallback', () => ({
  findAgentConfigForProvider: mock(() => Promise.resolve(null)),
  agentTypeToProvider: () => 'openai',
}));
mock.module('./role-provider-resolver', () => ({
  inferProviderFromModelId: () => 'claude',
}));
mock.module('../ai/model-route-stability', () => ({
  invalidateStableRoute: mock(() => Promise.resolve()),
}));
let routeResult: { modelId: string; details: Record<string, unknown> } = {
  modelId: 'claude-opus-5-5',
  details: { minTier: 'premium', minTierReason: '高リスク領域' },
};
const routeModelForRole = mock((_o: unknown) => Promise.resolve(routeResult));
mock.module('./role-route-inputs', () => ({ routeModelForRole }));
mock.module('../../config/database', () => ({
  prisma: {
    task: {
      findUnique: () => Promise.resolve({ title: 'T', description: 'd', labels: null, themeId: 3 }),
    },
  },
}));
const decisions: Array<Record<string, unknown>> = [];
mock.module('../observability/decision-trace', () => ({
  recordDecision: (input: Record<string, unknown>) => {
    decisions.push(input);
    return Promise.resolve();
  },
}));
mock.module('../ai/recovery-metrics', () => ({ recordRecoveryAttempt: () => {} }));

const { tryProviderFallback } = await import('./workflow-provider-fallback');

const runAgent = mock((cfg: { modelId: string | null }) =>
  Promise.resolve({ success: true, output: `ran ${cfg.modelId}` }),
);

function fallback() {
  return tryProviderFallback({
    taskId: 7,
    role: 'implementer',
    currentConfig: { id: 1, agentType: 'codex', name: 'codex', modelId: 'gpt-6.1-sol' },
    firstResult: { success: false, error: "You've hit your usage limit" } as never,
    runAgent: runAgent as never,
  });
}

beforeEach(() => {
  routeModelForRole.mockClear();
  getSmartRoute.mockClear();
  runAgent.mockClear();
  decisions.length = 0;
  routeResult = {
    modelId: 'claude-opus-5-5',
    details: { minTier: 'premium', minTierReason: '高リスク領域' },
  };
});

describe('途中でのベンダー利用不能', () => {
  test('ロールの制約を保ったまま、失敗したプロバイダを除いて再割り当てする', async () => {
    const result = await fallback();
    expect(routeModelForRole).toHaveBeenCalledTimes(1);
    const call = routeModelForRole.mock.calls[0][0] as {
      taskId: number;
      role: string;
      task: { title: string; themeId: number };
      excludeProviders: string[];
    };
    expect(call.role).toBe('implementer');
    expect(call.taskId).toBe(7);
    expect(call.task.themeId).toBe(3);
    expect(call.excludeProviders).toEqual(['openai']);
    // The bare call, which dropped the floors, is not used.
    expect(getSmartRoute).not.toHaveBeenCalled();
    expect((runAgent.mock.calls[0][0] as { modelId: string }).modelId).toBe('claude-opus-5-5');
    expect(result?.success).toBe(true);
    await new Promise((r) => setTimeout(r, 10)); // the audit record is fire-and-forget
    const recorded = decisions.find((d) =>
      String(d.summary).startsWith('プロバイダフォールバック'),
    );
    expect((recorded!.input as Record<string, unknown>).constraintsKept).toBe(true);
    expect((recorded!.input as Record<string, unknown>).minTier).toBe('premium');
  });

  test('ロール経路が答えられないときだけ素の SmartRouter に落ち、その旨を記録する', async () => {
    routeResult = { modelId: 'sonnet', details: { fallback: true } };
    await fallback();
    expect(getSmartRoute).toHaveBeenCalledTimes(1);
    expect(
      (getSmartRoute.mock.calls[0][1] as { excludeProviders: string[] }).excludeProviders,
    ).toEqual(['openai']);
    expect((runAgent.mock.calls[0][0] as { modelId: string }).modelId).toBe('bare-fallback');
    await new Promise((r) => setTimeout(r, 10)); // the audit record is fire-and-forget
    const recorded = decisions.find((d) =>
      String(d.summary).startsWith('プロバイダフォールバック'),
    );
    expect((recorded!.input as Record<string, unknown>).constraintsKept).toBe(false);
  });
});
