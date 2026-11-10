/**
 * role-route-inputs.repair-escalation テスト
 *
 * routing2a E の再現: 検証・陪審で差し戻されても修復ループはキューの retryCount
 * を増やさないため、次の implementer は同じ下限・同じ pin キーで同じモデルに
 * なっていた。差し戻しの記録（verify_repair とそれに続く adversarial_review_failed
 * の指摘）を原因別に分け、能力不足だけを再試行として数えることを固定する。
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const noopLogger = { info: () => {}, error: () => {}, warn: () => {}, debug: () => {} };
mock.module('../../config/logger', () => ({ createLogger: () => noopLogger, logger: noopLogger }));

type Row = { cause: string; metadata: string; createdAt: Date };
let transitions: Row[] = [];
let failTransitionRead = false;
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
        name === 'workflowTransition'
          ? {
              ...stubModel(),
              findMany: async (args: { where?: { cause?: { in?: string[] } } }) => {
                if (failTransitionRead) throw new Error('db down');
                const causes = args?.where?.cause?.in;
                return transitions.filter((t) => !causes || causes.includes(t.cause));
              },
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
mock.module('./task-budget', () => ({ resolveTaskBudgetCap: () => Promise.resolve(null) }));
mock.module('./workflow-file-utils', () => ({ readWorkflowFile: () => Promise.resolve(null) }));

const getStableSmartRoute = mock((_t: number, _r: string, _o: Record<string, unknown>) =>
  Promise.resolve({ recommendedModel: 'claude-sonnet-5-5', recommendedTier: 'standard' }),
);
mock.module('../ai/model-route-stability', () => ({ getStableSmartRoute }));

const { routeModelForRole } = await import('./role-route-inputs');
const { summarizeRepairCauses } = await import('./repair-escalation');

const TASK = { title: 'Rename a label', description: null, labels: '[]', themeId: null };
const optionsOfLastCall = () => getStableSmartRoute.mock.calls.at(-1)![2];
const at = (s: number) => new Date(Date.UTC(2026, 10, 10, 0, 0, s));
const bounce = (reason: string, s: number): Row => ({
  cause: 'verify_repair',
  metadata: JSON.stringify({ attempt: 1, reason }),
  createdAt: at(s),
});
const juryFail = (findings: unknown[], s: number): Row => ({
  cause: 'adversarial_review_failed',
  metadata: JSON.stringify({ findings }),
  createdAt: at(s),
});
const route = (role = 'implementer') => routeModelForRole({ taskId: 7, role, task: TASK });

beforeEach(() => {
  transitions = [];
  failTransitionRead = false;
  getStableSmartRoute.mockClear();
});

describe('差し戻しの原因別に格上げを決める', () => {
  test('差し戻しが無ければ implementer は standard 下限', async () => {
    await route();
    expect(optionsOfLastCall().minTier).toBe('standard');
  });

  test('機械ゲートで差し戻された後の implementer は premium 下限になる', async () => {
    transitions = [bounce('typecheck=NG(3) test=NG(1)', 1)];
    const r = await route();
    expect(optionsOfLastCall().minTier).toBe('premium');
    expect(String(optionsOfLastCall().minTierReason)).toContain('差し戻し');
    expect(r.details.repairCauses).toMatchObject({ capability: 1 });
  });

  test('根拠つきの陪審指摘で差し戻された後も premium 下限', async () => {
    transitions = [
      bounce('差分レビュー不合格: null 経路で例外', 1),
      juryFail(
        [{ severity: 'blocker', summary: 'null 経路で例外', evidence: 'a.ts:3', gating: true }],
        2,
      ),
    ];
    await route();
    expect(optionsOfLastCall().minTier).toBe('premium');
  });

  test('インフラ障害による差し戻しでは格上げしない', async () => {
    transitions = [bounce('test=NG: connect ECONNREFUSED 127.0.0.1:5432', 1)];
    const r = await route();
    expect(optionsOfLastCall().minTier).toBe('standard');
    expect(r.details.repairCauses).toMatchObject({ infrastructure: 1, capability: 0 });
  });

  test('根拠のない陪審指摘による差し戻しでは格上げしない', async () => {
    transitions = [
      bounce('差分レビュー不合格: 品質が低い', 1),
      juryFail([{ severity: 'major', summary: '品質が低い', gating: false, needsCheck: true }], 2),
    ];
    const r = await route();
    expect(optionsOfLastCall().minTier).toBe('standard');
    expect(r.details.repairCauses).toMatchObject({ unfounded: 1, capability: 0 });
  });

  test('要件不備による差し戻しでは格上げしない', async () => {
    transitions = [bounce('受入基準2が曖昧で検証不能', 1)];
    const r = await route();
    expect(optionsOfLastCall().minTier).toBe('standard');
    expect(r.details.repairCauses).toMatchObject({ requirements: 1, capability: 0 });
  });

  test('陪審の指摘は次の差し戻しより前のものだけを対応づける', async () => {
    // The first bounce has no jury row of its own; the evidenced findings
    // belong to the SECOND bounce. Mis-pairing would count both.
    transitions = [
      bounce('差分レビュー不合格: 受入基準を満たしていません', 1),
      bounce('差分レビュー不合格: null 経路で例外', 10),
      juryFail(
        [{ severity: 'blocker', summary: 'null 経路で例外', evidence: 'a.ts:3', gating: true }],
        11,
      ),
    ];
    const r = await route();
    expect(r.details.repairCauses).toMatchObject({ capability: 1, unfounded: 1 });
  });

  test('差し戻しから離れて記録された陪審の行は対応づけない', async () => {
    // A jury row with no bounce of its own (recovery-blocked path) lands
    // minutes later; its findings must not ground the earlier bounce.
    transitions = [
      bounce('差分レビュー不合格: 受入基準を満たしていません', 1),
      juryFail(
        [{ severity: 'blocker', summary: 'null 経路で例外', evidence: 'a.ts:3', gating: true }],
        300,
      ),
    ];
    const r = await route();
    expect(r.details.repairCauses).toMatchObject({ capability: 0, unfounded: 1 });
  });

  test('集計そのものも記録が読めなければ全0を返す（投げない）', async () => {
    failTransitionRead = true;
    expect(await summarizeRepairCauses(7)).toEqual({
      capability: 0,
      infrastructure: 0,
      requirements: 0,
      unfounded: 0,
    });
  });

  test('記録が読めなくても止まらず、格上げもしない（fail open）', async () => {
    failTransitionRead = true;
    const r = await route();
    expect(r.details.fallback).toBeUndefined();
    expect(optionsOfLastCall().minTier).toBe('standard');
  });

  test('premium 抑制の暫定停止を決定記録に残す', async () => {
    const r = await route();
    expect(r.details.premiumSuppression).toBe('suspended');
  });
});
