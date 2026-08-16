/**
 * miss-signature-service.test
 *
 * Review status guard (double-review rejection, auto_applied reject-only
 * correction path), knowledge-base sink on approval, auto-apply refusing in
 * manual mode and applying in auto mode (acceptance 3's service surface).
 * Prisma is mocked via mock.module (process-global — run in isolation).
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const noopLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

const suggestionFindUniqueMock = mock((_args: unknown) => Promise.resolve<unknown>(null));
const suggestionFindManyMock = mock((_args: unknown) => Promise.resolve([] as unknown[]));
const suggestionUpdateMock = mock((_args: unknown) => Promise.resolve({ id: 1 }));
const suggestionCountMock = mock((_args: unknown) => Promise.resolve(0));
const caseFindUniqueMock = mock((_args: unknown) => Promise.resolve<unknown>(null));
const caseCountMock = mock((_args: unknown) => Promise.resolve(0));
const knowledgeFindFirstMock = mock((_args: unknown) => Promise.resolve<unknown>(null));
const knowledgeCreateMock = mock((_args: unknown) => Promise.resolve({ id: 1 }));

mock.module('../../config/logger', () => ({
  getBackendLogFilePath: () => '/tmp/backend.log',
  logger: noopLogger,
  createLogger: () => noopLogger,
}));
mock.module('../../config/database', () => ({
  prisma: {
    missSignatureSuggestion: {
      findUnique: suggestionFindUniqueMock,
      findMany: suggestionFindManyMock,
      update: suggestionUpdateMock,
      count: suggestionCountMock,
    },
    detectionMissCase: { findUnique: caseFindUniqueMock, count: caseCountMock },
    knowledgeEntry: { findFirst: knowledgeFindFirstMock, create: knowledgeCreateMock },
  },
  ensureDatabaseConnection: () => Promise.resolve(),
}));
mock.module('../workflow/self-development-theme', () => ({
  resolveSelfDevelopmentThemeId: mock(() => Promise.resolve(42)),
  resetSelfDevelopmentThemeCache: () => {},
}));

const { reviewSuggestion, applyPendingAutomatically, getMissSummary } =
  await import('./miss-signature-service');

function pendingRow(over: Record<string, unknown> = {}) {
  return {
    id: 5,
    status: 'pending_review',
    caseId: 11,
    signature: 'stale-generated-artifacts',
    explanation: '生成物の再生成漏れはCIでのみ落ちる。',
    dedupKey: 'suggest:ci_repair:stale-generated-artifacts',
    ...over,
  };
}

function resetAll() {
  suggestionFindUniqueMock.mockReset().mockResolvedValue(null);
  suggestionFindManyMock.mockReset().mockResolvedValue([]);
  suggestionUpdateMock.mockReset().mockResolvedValue({ id: 1 });
  suggestionCountMock.mockReset().mockResolvedValue(0);
  caseFindUniqueMock.mockReset().mockResolvedValue(null);
  caseCountMock.mockReset().mockResolvedValue(0);
  knowledgeFindFirstMock.mockReset().mockResolvedValue(null);
  knowledgeCreateMock.mockReset().mockResolvedValue({ id: 1 });
}

describe('reviewSuggestion — status guard', () => {
  beforeEach(resetAll);

  test('pending_review の承認で approved になり KB へ反映される', async () => {
    suggestionFindUniqueMock.mockResolvedValue(pendingRow());

    const ok = await reviewSuggestion(5, true);

    expect(ok).toBe(true);
    const update = suggestionUpdateMock.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(update.data.status).toBe('approved');
    expect(update.data.reviewedBy).toBe('human');
    expect(knowledgeCreateMock).toHaveBeenCalledTimes(1);
    const kb = (knowledgeCreateMock.mock.calls[0]?.[0] as { data: Record<string, unknown> }).data;
    expect(kb.sourceType).toBe('miss_signature');
    expect(String(kb.title)).toContain('stale-generated-artifacts');
    expect(kb.themeId).toBe(42);
  });

  test('棄却は rejected になり KB へは反映されない', async () => {
    suggestionFindUniqueMock.mockResolvedValue(pendingRow());

    const ok = await reviewSuggestion(5, false);

    expect(ok).toBe(true);
    const update = suggestionUpdateMock.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(update.data.status).toBe('rejected');
    expect(knowledgeCreateMock).not.toHaveBeenCalled();
  });

  test('二重レビュー（approved 済み）は false を返し何も更新しない', async () => {
    suggestionFindUniqueMock.mockResolvedValue(pendingRow({ status: 'approved' }));
    const ok = await reviewSuggestion(5, true);
    expect(ok).toBe(false);
    expect(suggestionUpdateMock).not.toHaveBeenCalled();
  });

  test('auto_applied は棄却のみ可能（是正経路） — 承認は不可', async () => {
    suggestionFindUniqueMock.mockResolvedValue(pendingRow({ status: 'auto_applied' }));

    expect(await reviewSuggestion(5, true)).toBe(false);
    expect(suggestionUpdateMock).not.toHaveBeenCalled();

    expect(await reviewSuggestion(5, false)).toBe(true);
    const update = suggestionUpdateMock.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(update.data.status).toBe('rejected');
    expect(update.data.reviewedBy).toBe('human');
  });

  test('存在しない id は false', async () => {
    expect(await reviewSuggestion(999, true)).toBe(false);
  });
});

describe('applyPendingAutomatically — derived-mode guard', () => {
  beforeEach(resetAll);

  test('manual モード（初期ゲート）では自動反映を拒否する', async () => {
    // All counts 0 → totalHumanReviews < 10 → manual/initial_gate.
    const applied = await applyPendingAutomatically();
    expect(applied).toBe(0);
    expect(suggestionUpdateMock).not.toHaveBeenCalled();
  });

  test('auto モード（棄却率 0 / 十分な母数）では pending を auto_applied 化し KB へ反映', async () => {
    // count calls in getMissSummary order: totalHuman, windowSamples,
    // windowRejections, pending, approved, rejected, autoApplied.
    suggestionCountMock.mockImplementation((args: unknown) => {
      const where = (args as { where: Record<string, unknown> }).where;
      if (where.status === 'rejected' && where.reviewedBy === 'human' && where.reviewedAt) {
        return Promise.resolve(0); // window rejections
      }
      if (where.reviewedBy === 'human') return Promise.resolve(20); // total & window samples
      return Promise.resolve(0);
    });
    suggestionFindManyMock.mockResolvedValue([pendingRow()]);

    const applied = await applyPendingAutomatically();

    expect(applied).toBe(1);
    const update = suggestionUpdateMock.mock.calls[0]?.[0] as { data: Record<string, unknown> };
    expect(update.data.status).toBe('auto_applied');
    expect(update.data.reviewedBy).toBe('auto');
    expect(knowledgeCreateMock).toHaveBeenCalledTimes(1);
  });

  test('棄却率が閾値を超えると自動反映が承認必須へ戻る（受入基準3）', async () => {
    suggestionCountMock.mockImplementation((args: unknown) => {
      const where = (args as { where: Record<string, unknown> }).where;
      if (where.status === 'rejected' && where.reviewedBy === 'human' && where.reviewedAt) {
        return Promise.resolve(2); // 2/20 = 0.10 > 0.02
      }
      if (where.reviewedBy === 'human') return Promise.resolve(20);
      return Promise.resolve(0);
    });
    suggestionFindManyMock.mockResolvedValue([pendingRow()]);

    const applied = await applyPendingAutomatically();

    expect(applied).toBe(0);
    expect(suggestionUpdateMock).not.toHaveBeenCalled();
  });
});

describe('getMissSummary', () => {
  beforeEach(resetAll);

  test('サンプル不足では判定を出さず insufficient_data を返す（受入基準4）', async () => {
    suggestionCountMock.mockImplementation((args: unknown) => {
      const where = (args as { where: Record<string, unknown> }).where;
      if (where.status === 'rejected' && where.reviewedBy === 'human' && where.reviewedAt) {
        return Promise.resolve(0);
      }
      if (where.reviewedBy === 'human' && where.reviewedAt) return Promise.resolve(3); // window < floor
      if (where.reviewedBy === 'human') return Promise.resolve(15); // total ≥ initial gate
      return Promise.resolve(0);
    });

    const summary = await getMissSummary();

    expect(summary.decision.mode).toBe('manual');
    expect(summary.decision.basis).toBe('insufficient_data');
    expect(summary.decision.rejectionRate).toBeNull();
    expect(summary.window.samples).toBe(3);
  });
});
