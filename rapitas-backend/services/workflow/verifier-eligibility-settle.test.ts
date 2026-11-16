/**
 * verifier-eligibility-settle テスト
 *
 * 手動実行経路（execute-route）には CLI エピローグがないため、HTTP 保存で先送り
 * した完了判断を、実行後に人間の判断待ちへ確定させることを固定する。先送りがな
 * ければ何もしない（G2 routing1 再レビュー指摘5）。
 */
import { beforeEach, expect, mock, test } from 'bun:test';

mock.module('../../config/logger', () => ({
  createLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }),
}));

let task: Record<string, unknown> | null = null;
let latest: { cause: string } | null = null;
let verifierModel: string | null = 'claude-opus-5-5';
let dbDown = false;
mock.module('../../config/database', () => ({
  prisma: {
    task: {
      findUnique: async () => {
        if (dbDown) throw new Error('db down');
        return task;
      },
    },
    workflowTransition: { findFirst: async () => latest },
    agentExecution: {
      findFirst: async () => ({
        modelName: verifierModel,
        status: 'completed',
        session: { mode: 'workflow-verifier' },
      }),
      findMany: async () => [{ modelName: 'claude-opus-5-5' }],
    },
  },
}));
const holdForHumanReview = mock(
  async (_p: Record<string, unknown>): Promise<'held' | 'cas_lost'> => 'held',
);
mock.module('./review-hold', () => ({ holdForHumanReview }));
mock.module('./transition-recorder', () => ({ recordTransition: async () => undefined }));

const { settleDeferredVerifierEligibility } = await import('./verifier-eligibility-settle');

beforeEach(() => {
  task = { workflowStatus: 'verify_done', status: 'in-progress', haltReason: null };
  latest = { cause: 'verifier_eligibility_deferred' };
  verifierModel = 'claude-opus-5-5';
  dbDown = false;
  holdForHumanReview.mockReset().mockResolvedValue('held');
});

test('先送りされていて実行後も不適格なら、不適格として保留する', async () => {
  verifierModel = 'claude-haiku-5-5';
  expect(await settleDeferredVerifierEligibility(5, 9)).toBe('held');
  expect(holdForHumanReview.mock.calls[0][0].reason).toBe('ineligible_verifier');
  expect(String(holdForHumanReview.mock.calls[0][0].detail)).toContain('レビュー不可');
});

test('先送りされていて実行後に適格と分かっても、自動では完了させず人間に回す', async () => {
  expect(await settleDeferredVerifierEligibility(5, 9)).toBe('held');
  expect(String(holdForHumanReview.mock.calls[0][0].detail)).toContain('claude-opus-5-5');
  expect(String(holdForHumanReview.mock.calls[0][0].detail)).toContain('未報告');
});

test('先送りの記録がなければ何もしない', async () => {
  latest = { cause: 'file_saved:verify' };
  expect(await settleDeferredVerifierEligibility(5, 9)).toBe('none');
  expect(holdForHumanReview).not.toHaveBeenCalled();
});

test('タスクが verify_done を離れていれば何もしない', async () => {
  task = { workflowStatus: 'completed', status: 'done', haltReason: null };
  expect(await settleDeferredVerifierEligibility(5, 9)).toBe('none');
  expect(holdForHumanReview).not.toHaveBeenCalled();
});

test('読み取りに失敗しても例外を投げない', async () => {
  dbDown = true;
  expect(await settleDeferredVerifierEligibility(5, 9)).toBe('error');
});
