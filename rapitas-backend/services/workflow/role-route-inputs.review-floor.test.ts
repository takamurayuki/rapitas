/**
 * role-route-inputs.review-floor テスト
 *
 * 通常の verifier / auto_verifier の経路（途中切替もこれを使う）で、下限が実行役
 * のティア以上に引き上がること（実行役は実行記録から求め、不明なら premium とみ
 * なす）と、SmartRouter の要件未達がロール解決の戻り値に残ることを固定する。
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const noopLogger = { info: () => {}, error: () => {}, warn: () => {}, debug: () => {} };
mock.module('../../config/logger', () => ({ createLogger: () => noopLogger }));

/** Models the implementer's runs reported, newest first. */
let implementerRuns: string[] = [];
const stubModel = () => ({
  findMany: () => Promise.resolve([]),
  findFirst: () => Promise.resolve(null),
  findUnique: () => Promise.resolve(null),
  count: () => Promise.resolve(0),
  groupBy: () => Promise.resolve([]),
});
mock.module('../../config/database', () => ({
  prisma: new Proxy(
    {},
    {
      get: (_t, name) =>
        name === 'agentExecution'
          ? {
              ...stubModel(),
              findMany: async () => implementerRuns.map((modelName) => ({ modelName })),
            }
          : stubModel(),
    },
  ),
  ensureDatabaseConnection: () => Promise.resolve(),
}));
mock.module('./role-provider-resolver', () => ({
  resolveRoleProviderPreferences: () => Promise.resolve({}),
  inferProviderFromModelId: mock(() => null),
}));
/** Budget state the next resolveTaskBudgetCap returns (null = under budget). */
let budgetState: Record<string, unknown> | null = null;
mock.module('./task-budget', () => ({ resolveTaskBudgetCap: () => Promise.resolve(budgetState) }));
mock.module('./workflow-file-utils', () => ({ readWorkflowFile: () => Promise.resolve(null) }));

let routeReturn: Record<string, unknown> = {};
const getStableSmartRoute = mock((_t: number, _r: string, _o: Record<string, unknown>) =>
  Promise.resolve({
    recommendedModel: 'claude-opus-5-5',
    recommendedTier: 'premium',
    ...routeReturn,
  }),
);
mock.module('../ai/model-route-stability', () => ({ getStableSmartRoute }));

const { routeModelForRole } = await import('./role-route-inputs');

const TASK = { title: 'Rename a label', description: null, labels: '[]', themeId: null };
const optionsOfLastCall = () => getStableSmartRoute.mock.calls.at(-1)![2];

beforeEach(() => {
  implementerRuns = [];
  routeReturn = {};
  budgetState = null;
  getStableSmartRoute.mockClear();
});

describe('レビュー系ロールの下限 ≧ 実行役のティア', () => {
  test('premium の実装（Opus）を判定する verifier の下限は premium', async () => {
    implementerRuns = ['claude-opus-5-5'];
    const r = await routeModelForRole({ taskId: 5, role: 'verifier', task: TASK });
    expect(optionsOfLastCall().minTier).toBe('premium');
    expect(String(optionsOfLastCall().minTierReason)).toContain('claude-opus-5-5');
    expect(r.details.executorModel).toBe('claude-opus-5-5');
  });

  test('auto_verifier も同じ連動を受ける', async () => {
    implementerRuns = ['claude-opus-5-5'];
    await routeModelForRole({ taskId: 5, role: 'auto_verifier', task: TASK });
    expect(optionsOfLastCall().minTier).toBe('premium');
  });

  test('standard の実装なら、方針の下限（standard）より上げない', async () => {
    implementerRuns = ['claude-sonnet-5-5'];
    await routeModelForRole({ taskId: 5, role: 'verifier', task: TASK });
    expect(optionsOfLastCall().minTier).toBe('standard');
  });

  test('実行役が実行記録から分からなければ premium とみなす', async () => {
    implementerRuns = [];
    const r = await routeModelForRole({ taskId: 5, role: 'verifier', task: TASK });
    expect(optionsOfLastCall().minTier).toBe('premium');
    expect(r.details.executorVerified).toBe(false);
  });

  test('implementer 自身の経路は実行役の連動を受けない', async () => {
    implementerRuns = ['claude-opus-5-5'];
    await routeModelForRole({ taskId: 5, role: 'implementer', task: TASK });
    expect(optionsOfLastCall().minTier).toBe('standard');
  });
});

describe('要件未達はロール解決の戻り値に残る', () => {
  test('SmartRouter の constraintShortfall を戻り値と details に載せる', async () => {
    implementerRuns = ['claude-sonnet-5-5'];
    const shortfall = {
      kind: 'role',
      requiredTier: 'standard',
      selectedTier: 'economy',
      reason: 'ティア表で verifier に置けるモデルが使えない（haiku を使用）',
    };
    routeReturn = {
      recommendedModel: 'haiku',
      recommendedTier: 'economy',
      constraintShortfall: shortfall,
    };
    const r = await routeModelForRole({ taskId: 5, role: 'verifier', task: TASK });
    expect(r.modelId).toBe('haiku');
    expect(r.constraintShortfall).toEqual(shortfall);
    expect(r.details.constraintShortfall).toEqual(shortfall);
  });
});

// Tasks 520 and 514 (2026-11-20/21): the over-budget cap put the verifier on a
// standard model while the implementer ran premium, so the verify was always
// ruled ineligible and the task held, after paying for the verify run.
describe('予算超過の上限はレビュー役を実行役より下げない', () => {
  const OVER = { spentUsd: 41, budgetUsd: 40, capTier: 'standard', reason: 'タスク予算超過' };

  test('予算超過でも premium の実装を判定する verifier は standard に抑えない', async () => {
    implementerRuns = ['claude-opus-5-5'];
    budgetState = OVER;
    await routeModelForRole({ taskId: 5, role: 'verifier', task: TASK });
    expect(optionsOfLastCall().minTier).toBe('premium');
    expect(optionsOfLastCall().hardCapTier).toBeUndefined();
  });

  test('予算超過の上限は implementer にはそのまま効く', async () => {
    implementerRuns = ['claude-opus-5-5'];
    budgetState = OVER;
    await routeModelForRole({ taskId: 5, role: 'implementer', task: TASK });
    expect(optionsOfLastCall().hardCapTier).toBe('standard');
  });

  test('暴走（economy 上限）はレビュー役にも効く', async () => {
    implementerRuns = ['claude-opus-5-5'];
    budgetState = { ...OVER, spentUsd: 130, capTier: 'economy' };
    await routeModelForRole({ taskId: 5, role: 'verifier', task: TASK });
    expect(optionsOfLastCall().hardCapTier).toBe('economy');
  });
});
