/**
 * verifier-eligibility テスト
 *
 * verify フェーズを担ったモデルがレビュー不適格（未登録・economy・deprecated・実
 * 行役より下位）なら、その判定を検証として使わせず人間の判断待ちにすることを固
 * 定する。モデルは実行記録の報告値を優先し、実行中は起動時の指定（明示モデル→
 * pin）を使い、どちらもなければ未確認として保留する。
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const noopLogger = { info: () => {}, error: () => {}, warn: () => {}, debug: () => {} };
mock.module('../../config/logger', () => ({ createLogger: () => noopLogger }));

type Run = { modelName: string | null; session: { mode: string } } | null;
let verifierRun: Run = null;
let implementerRuns: string[] = [];
let roleConfigModel: string | null = null;
let pinModel: string | null = null;
let dbDown = false;

mock.module('../../config/database', () => ({
  prisma: {
    agentExecution: {
      findFirst: async () => {
        if (dbDown) throw new Error('db down');
        return verifierRun;
      },
      findMany: async () => implementerRuns.map((modelName) => ({ modelName })),
    },
    workflowRoleConfig: {
      findFirst: async () => (roleConfigModel === null ? null : { modelId: roleConfigModel }),
    },
  },
}));
mock.module('../memory/timeline', () => ({
  queryEvents: async () => ({
    events: pinModel ? [{ payload: { decision: { recommendedModel: pinModel } } }] : [],
    total: pinModel ? 1 : 0,
  }),
}));
const holdForHumanReview = mock(async (_p: Record<string, unknown>) => 'held' as const);
mock.module('./review-hold', () => ({ holdForHumanReview }));

const { judgeVerifierEligibility, holdIfVerifierIneligible } =
  await import('./verifier-eligibility');

const run = (modelName: string | null, role = 'verifier'): Run => ({
  modelName,
  session: { mode: `workflow-${role}` },
});

beforeEach(() => {
  verifierRun = null;
  implementerRuns = ['claude-sonnet-5-5'];
  roleConfigModel = null;
  pinModel = null;
  dbDown = false;
  holdForHumanReview.mockClear();
});

describe('judgeVerifierEligibility', () => {
  test('適格: レビュー可で実行役以上（Sonnet の実装を Opus が検証）', async () => {
    verifierRun = run('claude-opus-5-5');
    expect((await judgeVerifierEligibility(1)).status).toBe('eligible');
  });

  test('不適格: 未登録モデル（候補ゼロでフィルタが外れて選ばれた場合）', async () => {
    verifierRun = run('claude-sonnet-4-20250514');
    const j = await judgeVerifierEligibility(1);
    expect(j.status).toBe('ineligible');
    expect(j.status === 'ineligible' && j.reason).toContain('登録がなく');
  });

  test('不適格: economy（Haiku はティア表でレビュー不可）', async () => {
    verifierRun = run('claude-haiku-5-5');
    expect((await judgeVerifierEligibility(1)).status).toBe('ineligible');
  });

  test('不適格: premium の実装を standard が検証した', async () => {
    implementerRuns = ['claude-opus-5-5'];
    verifierRun = run('claude-sonnet-5-5');
    const j = await judgeVerifierEligibility(1);
    expect(j.status).toBe('ineligible');
    expect(j.status === 'ineligible' && j.reason).toContain('下回る');
  });

  test('実行役が確認できなければ premium とみなす（standard の検証は不適格）', async () => {
    implementerRuns = [];
    verifierRun = run('claude-sonnet-5-5');
    expect((await judgeVerifierEligibility(1)).status).toBe('ineligible');
  });

  test('auto_verifier も同じ判定を受ける', async () => {
    verifierRun = run('claude-haiku-5-5', 'auto_verifier');
    const j = await judgeVerifierEligibility(1);
    expect(j.status).toBe('ineligible');
    expect(j.status === 'ineligible' && j.role).toBe('auto_verifier');
  });

  test('実行中（報告前）は明示モデル、なければ pin で判定する', async () => {
    verifierRun = run(null);
    pinModel = 'claude-haiku-5-5';
    expect((await judgeVerifierEligibility(1)).status).toBe('ineligible');
    roleConfigModel = 'claude-opus-5-5';
    expect((await judgeVerifierEligibility(1)).status).toBe('eligible');
  });

  test('モデルが何も分からなければ未確認', async () => {
    verifierRun = run(null);
    expect((await judgeVerifierEligibility(1)).status).toBe('unverified');
  });

  test('報告値の日付付きスナップショットは、その行として判定する', async () => {
    verifierRun = run('claude-opus-5-5-20261101');
    expect((await judgeVerifierEligibility(1)).status).toBe('eligible');
  });

  test('verifier の実行がなければ判定しない（人が書いた verify.md など）', async () => {
    verifierRun = null;
    expect((await judgeVerifierEligibility(1)).status).toBe('no_verifier_run');
  });
});

describe('holdIfVerifierIneligible', () => {
  test('不適格なら人間の判断待ちに保留し、検証として使わせない', async () => {
    implementerRuns = ['claude-opus-5-5'];
    verifierRun = run('claude-sonnet-5-5');
    const r = await holdIfVerifierIneligible({ taskId: 1, source: 'http_save' });
    expect(r.outcome).toBe('held');
    expect(holdForHumanReview).toHaveBeenCalledTimes(1);
    const arg = holdForHumanReview.mock.calls[0][0];
    expect(arg.reason).toBe('ineligible_verifier');
    expect((arg.extra as Record<string, unknown>).verifierModel).toBe('claude-sonnet-5-5');
  });

  test('未確認でも保留する', async () => {
    verifierRun = run(null);
    expect((await holdIfVerifierIneligible({ taskId: 1, source: 'cli_epilogue' })).outcome).toBe(
      'held',
    );
  });

  test('適格なら何もしない', async () => {
    verifierRun = run('claude-opus-5-5');
    expect((await holdIfVerifierIneligible({ taskId: 1, source: 'http_save' })).outcome).toBe('ok');
    expect(holdForHumanReview).not.toHaveBeenCalled();
  });

  test('記録が読めないときは他の verify ゲートと同じく開いたまま通す', async () => {
    dbDown = true;
    const r = await holdIfVerifierIneligible({ taskId: 1, source: 'http_save' });
    expect(r.judgement.status).toBe('lookup_failed');
    expect(r.outcome).toBe('ok');
  });
});
