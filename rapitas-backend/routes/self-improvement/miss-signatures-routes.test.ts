/**
 * miss-signatures-routes.test
 *
 * Route-level tests via Elysia handle(): pending listing (acceptance 2),
 * summary payload (acceptance 3/4 surface), review verdicts, 404 on
 * missing/double review, 400 on bad ids. miss-signature-service is stubbed
 * via mock.module (process-global — run this file in isolation).
 */
import { describe, it, expect, mock, beforeEach } from 'bun:test';

const noopLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

const listSuggestionsMock = mock((_status?: string) => Promise.resolve([] as unknown[]));
const reviewSuggestionMock = mock((_id: number, _approved: boolean) => Promise.resolve(true));
const getMissSummaryMock = mock(() =>
  Promise.resolve({
    decision: { mode: 'manual', basis: 'initial_gate', rejectionRate: null },
    counts: { pendingReview: 1, approved: 0, rejected: 0, autoApplied: 0, cases: 1 },
    window: { days: 30, samples: 0, rejections: 0 },
  }),
);

mock.module('../../config/logger', () => ({
  getBackendLogFilePath: () => '/tmp/backend.log',
  logger: noopLogger,
  createLogger: () => noopLogger,
}));
mock.module('../../services/self-improvement/miss-signature-service', () => ({
  listSuggestions: listSuggestionsMock,
  reviewSuggestion: reviewSuggestionMock,
  getMissSummary: getMissSummaryMock,
  MISS_SIGNATURE_SOURCE_TYPE: 'miss_signature',
  applyPendingAutomatically: mock(() => Promise.resolve(0)),
}));

const { missSignaturesRoutes } = await import('./miss-signatures-routes');

const BASE = 'http://localhost/self-improvement/miss-signatures';

describe('GET /self-improvement/miss-signatures', () => {
  beforeEach(() => {
    listSuggestionsMock.mockReset().mockResolvedValue([]);
    reviewSuggestionMock.mockReset().mockResolvedValue(true);
  });

  it('既定で pending_review の一覧を返す（初期は全件承認待ち — 受入基準2）', async () => {
    listSuggestionsMock.mockResolvedValue([
      { id: 1, signature: 'cue-a', explanation: 'why', status: 'pending_review' },
    ]);

    const res = await missSignaturesRoutes.handle(new Request(`${BASE}/`));
    const body = (await res.json()) as { suggestions: { status: string }[] };

    expect(res.status).toBe(200);
    expect(listSuggestionsMock).toHaveBeenCalledWith('pending_review');
    expect(body.suggestions[0]!.status).toBe('pending_review');
  });

  it('status クエリでフィルタを切り替えられる', async () => {
    await missSignaturesRoutes.handle(new Request(`${BASE}/?status=rejected`));
    expect(listSuggestionsMock).toHaveBeenCalledWith('rejected');
  });
});

describe('GET /self-improvement/miss-signatures/summary', () => {
  it('モード・根拠・棄却率・件数を返す', async () => {
    const res = await missSignaturesRoutes.handle(new Request(`${BASE}/summary`));
    const body = (await res.json()) as {
      success: boolean;
      summary: { decision: { mode: string; basis: string } };
    };
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.summary.decision.mode).toBe('manual');
    expect(body.summary.decision.basis).toBe('initial_gate');
  });

  it('集計失敗時は 500 を返す', async () => {
    getMissSummaryMock.mockImplementationOnce(() => Promise.reject(new Error('db down')));
    const res = await missSignaturesRoutes.handle(new Request(`${BASE}/summary`));
    expect(res.status).toBe(500);
  });
});

describe('POST /self-improvement/miss-signatures/:id/review', () => {
  beforeEach(() => {
    reviewSuggestionMock.mockReset().mockResolvedValue(true);
  });

  function reviewRequest(id: string, approved: boolean) {
    return new Request(`${BASE}/${id}/review`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ approved }),
    });
  }

  it('棄却の判定がサービスへ渡り success を返す', async () => {
    const res = await missSignaturesRoutes.handle(reviewRequest('5', false));
    const body = (await res.json()) as { success: boolean; approved: boolean };
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.approved).toBe(false);
    expect(reviewSuggestionMock).toHaveBeenCalledWith(5, false);
  });

  it('存在しない・レビュー不能（二重承認）な提案は 404', async () => {
    reviewSuggestionMock.mockResolvedValue(false);
    const res = await missSignaturesRoutes.handle(reviewRequest('999', true));
    expect(res.status).toBe(404);
  });

  it('数値でない id は 400', async () => {
    const res = await missSignaturesRoutes.handle(reviewRequest('abc', true));
    expect(res.status).toBe(400);
  });
});
