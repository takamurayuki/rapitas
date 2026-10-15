/**
 * prompt-version-history ユニットテスト
 *
 * resolvePromptVersionHistory の履歴復元順序、resolvePromptVersionForExecution
 * の境界時刻判定、recommendPromptVersion の閾値到達/未到達(探索モード)分岐を
 * computeBandEvidence をモックして検証する。
 * Own file — mock.module is process-global.
 */
import { describe, test, expect, mock, beforeEach } from 'bun:test';

const noopLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
mock.module('../../../config/logger', () => ({
  createLogger: () => noopLogger,
  logger: noopLogger,
}));

interface EvoRow {
  id: number;
  afterPrompt: string;
  evidenceJson: string | null;
  createdAt: Date;
}

let evoRows: EvoRow[] = [];
const promptEvolutionFindMany = mock(() => Promise.resolve(evoRows));

mock.module('../../../config/database', () => ({
  ensureDatabaseConnection: async () => {},
  prisma: { promptEvolution: { findMany: promptEvolutionFindMany } },
}));

interface BandEvidenceStub {
  sampleSize: number;
  verifyFailureRate: number;
  avgIterationCount: number;
  avgExecutionTimeMs: number;
  avgInputTokens: number;
  avgVerifyComplexity: number;
  confidenceScore: number;
  insufficientData: boolean;
}

let evidenceByVersion = new Map<number, BandEvidenceStub>();
const computeBandEvidence = mock(
  (_role: string, _model: string, _band: string, range: { validFrom: Date }) => {
    // Keyed by validFrom time so each history window resolves to its own stub.
    for (const [versionId, evidence] of evidenceByVersion) {
      if (versionKeyToValidFrom.get(versionId)?.getTime() === range.validFrom.getTime()) {
        return Promise.resolve(evidence);
      }
    }
    return Promise.resolve(insufficientStub(0));
  },
);
const versionKeyToValidFrom = new Map<number, Date>();

function insufficientStub(sampleSize: number): BandEvidenceStub {
  return {
    sampleSize,
    verifyFailureRate: 0,
    avgIterationCount: 0,
    avgExecutionTimeMs: 0,
    avgInputTokens: 0,
    avgVerifyComplexity: 0,
    confidenceScore: 0,
    insufficientData: true,
  };
}

mock.module('./prompt-band-evidence', () => ({
  computeBandEvidence,
  resolveComplexityBand: (score: number) =>
    score <= 35 ? 'light' : score <= 70 ? 'standard' : 'comprehensive',
  BAND_EVIDENCE_MIN_SAMPLES: 8,
}));

const { resolvePromptVersionHistory, resolvePromptVersionForExecution, recommendPromptVersion } =
  await import('./prompt-version-history');

function row(id: number, approvedAt: string | null, createdAt: string): EvoRow {
  return {
    id,
    afterPrompt: `addendum-${id}`,
    evidenceJson: approvedAt ? JSON.stringify({ approvedAt }) : null,
    createdAt: new Date(createdAt),
  };
}

beforeEach(() => {
  evoRows = [];
  evidenceByVersion = new Map();
  versionKeyToValidFrom.clear();
  promptEvolutionFindMany.mockClear();
  computeBandEvidence.mockClear();
});

describe('resolvePromptVersionHistory', () => {
  test('approvedAt昇順で並び、次バージョンのvalidFromが前バージョンのvalidUntilになる', async () => {
    evoRows = [
      row(2, '2026-02-01T00:00:00Z', '2026-02-01T00:00:00Z'),
      row(1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
    ];
    const history = await resolvePromptVersionHistory('implementer');
    expect(history.map((v) => v.versionId)).toEqual([1, 2]);
    expect(history[0].validUntil).toEqual(history[1].validFrom);
    expect(history[1].validUntil).toBeNull();
  });

  test('evidenceJsonが無い行はcreatedAtをvalidFromとして使う', async () => {
    evoRows = [row(1, null, '2026-01-05T00:00:00Z')];
    const history = await resolvePromptVersionHistory('implementer');
    expect(history[0].validFrom).toEqual(new Date('2026-01-05T00:00:00Z'));
  });
});

describe('resolvePromptVersionForExecution', () => {
  const history = [
    {
      versionId: 1,
      content: 'a',
      validFrom: new Date('2026-01-01T00:00:00Z'),
      validUntil: new Date('2026-02-01T00:00:00Z'),
    },
    { versionId: 2, content: 'b', validFrom: new Date('2026-02-01T00:00:00Z'), validUntil: null },
  ];

  test('境界時刻直前はバージョン1に、直後はバージョン2に紐づく', () => {
    expect(resolvePromptVersionForExecution(new Date('2026-01-31T23:59:59Z'), history)).toBe(1);
    expect(resolvePromptVersionForExecution(new Date('2026-02-01T00:00:00Z'), history)).toBe(2);
  });

  test('最初のバージョンより前の実行はnullを返す', () => {
    expect(resolvePromptVersionForExecution(new Date('2025-12-01T00:00:00Z'), history)).toBeNull();
  });
});

describe('recommendPromptVersion', () => {
  test('履歴が無ければexplorationMode=trueでrecommendedVersionId=null', async () => {
    evoRows = [];
    const rec = await recommendPromptVersion('implementer', 'claude-sonnet-5', 20);
    expect(rec.explorationMode).toBe(true);
    expect(rec.recommendedVersionId).toBeNull();
    expect(rec.band).toBe('light');
  });

  test('全セルがサンプル閾値未満ならexplorationMode=true', async () => {
    evoRows = [row(1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')];
    versionKeyToValidFrom.set(1, new Date('2026-01-01T00:00:00Z'));
    evidenceByVersion.set(1, insufficientStub(3));

    const rec = await recommendPromptVersion('implementer', 'claude-sonnet-5', 20);
    expect(rec.explorationMode).toBe(true);
    expect(rec.sampleSize).toBe(3);
  });

  test('閾値を満たすバージョンが1つあれば、それを推薦しexplorationMode=false', async () => {
    evoRows = [row(1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')];
    versionKeyToValidFrom.set(1, new Date('2026-01-01T00:00:00Z'));
    evidenceByVersion.set(1, {
      sampleSize: 10,
      verifyFailureRate: 0.1,
      avgIterationCount: 0.2,
      avgExecutionTimeMs: 1000,
      avgInputTokens: 100,
      avgVerifyComplexity: 3,
      confidenceScore: 0.8,
      insufficientData: false,
    });

    const rec = await recommendPromptVersion('implementer', 'claude-sonnet-5', 20);
    expect(rec.explorationMode).toBe(false);
    expect(rec.recommendedVersionId).toBe(1);
    expect(rec.successRate).toBeCloseTo(0.9, 5);
    expect(rec.sampleSize).toBe(10);
  });

  test('閾値を満たす複数バージョンから成功率最大のものを選ぶ', async () => {
    evoRows = [
      row(1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
      row(2, '2026-02-01T00:00:00Z', '2026-02-01T00:00:00Z'),
    ];
    versionKeyToValidFrom.set(1, new Date('2026-01-01T00:00:00Z'));
    versionKeyToValidFrom.set(2, new Date('2026-02-01T00:00:00Z'));
    evidenceByVersion.set(1, {
      sampleSize: 10,
      verifyFailureRate: 0.5,
      avgIterationCount: 1,
      avgExecutionTimeMs: 1000,
      avgInputTokens: 100,
      avgVerifyComplexity: 3,
      confidenceScore: 0.8,
      insufficientData: false,
    });
    evidenceByVersion.set(2, {
      sampleSize: 12,
      verifyFailureRate: 0.1,
      avgIterationCount: 0.2,
      avgExecutionTimeMs: 900,
      avgInputTokens: 90,
      avgVerifyComplexity: 2,
      confidenceScore: 0.9,
      insufficientData: false,
    });

    const rec = await recommendPromptVersion('implementer', 'claude-sonnet-5', 20);
    expect(rec.recommendedVersionId).toBe(2);
    expect(rec.successRate).toBeCloseTo(0.9, 5);
  });
});
