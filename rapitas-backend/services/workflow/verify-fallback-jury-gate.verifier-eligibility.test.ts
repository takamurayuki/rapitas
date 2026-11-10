/**
 * verify-fallback-jury-gate.verifier-eligibility テスト
 *
 * CLI エピローグ経路（verify.md を HTTP で保存せず回収した場合）でも、レビュー不
 * 適格なモデルが出した verify の判定を検証として使わせない: 陪審にも commit/PR
 * にも進めず、人間の判断待ちにすることを、実物の verifier-eligibility を通して
 * 固定する。
 */
import { beforeEach, expect, mock, test } from 'bun:test';

mock.module('../../config/logger', () => ({
  createLogger: () => ({ info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));
mock.module('../../config', () => ({
  prisma: {
    task: { findUnique: async () => ({ title: 'Add feature', githubPrId: null }) },
    agentSession: { findFirst: async () => ({ worktreePath: '/wt' }) },
  },
}));
let verifierModel = 'claude-haiku-5-5';
mock.module('../../config/database', () => ({
  prisma: {
    agentExecution: {
      findFirst: async () => ({ modelName: verifierModel, session: { mode: 'workflow-verifier' } }),
      findMany: async () => [{ modelName: 'claude-sonnet-5-5' }],
    },
    workflowRoleConfig: { findFirst: async () => null },
  },
}));
mock.module('../memory/timeline', () => ({
  queryEvents: async () => ({ events: [], total: 0 }),
  appendEvent: async () => ({ id: 1 }),
}));
mock.module('./verify-jury-completion', () => ({
  withTaskJuryGate: (_id: number, fn: () => Promise<unknown>) => fn(),
  JuryGateBusyError: class extends Error {},
  readVerifySha256: async () => null,
  findJuryGateCompletion: async () => null,
  recordJuryGateCompletion: async () => undefined,
}));
mock.module('../agents/verification/review-diff-fingerprint', () => ({
  currentDiffFingerprint: async () => null,
  fingerprintDiff: () => null,
}));
const review = mock(async (_p: unknown) => ({ verdict: 'pass', severity: 0, reasons: [] }));
mock.module('../agents/verification/adversarial-diff-review', () => ({
  reviewDiffAdversarially: review,
}));
const holdForHumanReview = mock(async (_p: Record<string, unknown>) => 'held' as const);
mock.module('./review-hold', () => ({ holdForHumanReview }));

const { runFallbackJuryGate } = await import('./verify-fallback-jury-gate');

const params = {
  taskId: 77,
  currentWfStatus: 'verify_done',
  verifyContent: 'PASS',
  worktreePath: '/wt',
  actor: 'verifier' as const,
  sessionId: 5,
};

beforeEach(() => {
  review.mockClear();
  holdForHumanReview.mockClear();
});

test('レビュー不可のモデル（Haiku）の verify は、陪審にも commit/PR にも進めず保留する', async () => {
  verifierModel = 'claude-haiku-5-5';
  const out = await runFallbackJuryGate(params);
  expect(out.stop).toBe(true);
  expect(out.skipped).toBe('ineligible_verifier');
  expect(review).not.toHaveBeenCalled();
  expect(holdForHumanReview.mock.calls[0][0].reason).toBe('ineligible_verifier');
  expect(holdForHumanReview.mock.calls[0][0].source).toBe('cli_epilogue');
});

test('適格な検証役なら、これまでどおり陪審へ進む', async () => {
  verifierModel = 'claude-opus-5-5';
  await runFallbackJuryGate(params);
  expect(holdForHumanReview).not.toHaveBeenCalled();
  expect(review).toHaveBeenCalledTimes(1);
});
