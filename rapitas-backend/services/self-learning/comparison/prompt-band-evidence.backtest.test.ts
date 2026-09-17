/**
 * prompt-band-evidence backtest
 *
 * Validates task #970's受入基準: compares the SUCCESS RATE of the current
 * "apply the latest approved version to every task, regardless of difficulty
 * band" behavior against the band-aware recommendation
 * (recommendPromptVersion) on the SAME synthetic past-outcome fixture. Per
 * plan.md's 受入基準の比較対象, a passing backtest means either an improvement
 * over the naive baseline, or an honest insufficient_data — never a silent
 * "no data" masquerading as an improvement.
 * Own file — mock.module is process-global (separate from the regular unit tests).
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

/** versionId -> band evidence, for the ONLY band this backtest exercises ('standard'). */
let evidenceByVersion = new Map<number, BandEvidenceStub>();
const versionKeyToValidFrom = new Map<number, Date>();

const computeBandEvidence = mock(
  (_role: string, _model: string, _band: string, range: { validFrom: Date }) => {
    for (const [versionId, evidence] of evidenceByVersion) {
      if (versionKeyToValidFrom.get(versionId)?.getTime() === range.validFrom.getTime()) {
        return Promise.resolve(evidence);
      }
    }
    return Promise.resolve({
      sampleSize: 0,
      verifyFailureRate: 0,
      avgIterationCount: 0,
      avgExecutionTimeMs: 0,
      avgInputTokens: 0,
      avgVerifyComplexity: 0,
      confidenceScore: 0,
      insufficientData: true,
    });
  },
);

mock.module('./prompt-band-evidence', () => ({
  computeBandEvidence,
  resolveComplexityBand: (score: number) =>
    score <= 35 ? 'light' : score <= 70 ? 'standard' : 'comprehensive',
  BAND_EVIDENCE_MIN_SAMPLES: 8,
}));

const { resolvePromptVersionHistory, recommendPromptVersion } =
  await import('./prompt-version-history');

function row(id: number, approvedAt: string, createdAt: string): EvoRow {
  return {
    id,
    afterPrompt: `addendum-${id}`,
    evidenceJson: JSON.stringify({ approvedAt }),
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

describe('band-aware recommendation vs naive latest-version-for-everyone baseline', () => {
  test('sufficient sample: recommended version success rate is >= the naive latest-version baseline', async () => {
    // v1 (older) happens to work BETTER for the 'standard' band than v2 (latest) —
    // the naive baseline ("always apply the latest approved version") always
    // picks v2, while a band-aware recommendation should surface v1 instead.
    evoRows = [
      row(1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
      row(2, '2026-02-01T00:00:00Z', '2026-02-01T00:00:00Z'),
    ];
    versionKeyToValidFrom.set(1, new Date('2026-01-01T00:00:00Z'));
    versionKeyToValidFrom.set(2, new Date('2026-02-01T00:00:00Z'));
    evidenceByVersion.set(1, {
      sampleSize: 20,
      verifyFailureRate: 0.1, // 90% success
      avgIterationCount: 0.15,
      avgExecutionTimeMs: 800,
      avgInputTokens: 90,
      avgVerifyComplexity: 2,
      confidenceScore: 0.9,
      insufficientData: false,
    });
    evidenceByVersion.set(2, {
      sampleSize: 15,
      verifyFailureRate: 0.4, // 60% success — the naive "latest" baseline
      avgIterationCount: 0.9,
      avgExecutionTimeMs: 1500,
      avgInputTokens: 200,
      avgVerifyComplexity: 5,
      confidenceScore: 0.7,
      insufficientData: false,
    });

    const history = await resolvePromptVersionHistory('implementer');
    const naiveLatest = history[history.length - 1];
    const naiveLatestSuccessRate =
      1 - (evidenceByVersion.get(naiveLatest.versionId)?.verifyFailureRate ?? 1);

    const recommendation = await recommendPromptVersion('implementer', 'claude-sonnet-5', 50);

    expect(recommendation.explorationMode).toBe(false);
    expect(recommendation.successRate).not.toBeNull();
    expect(recommendation.successRate as number).toBeGreaterThanOrEqual(naiveLatestSuccessRate);
    // Confirms the recommendation actually diverged from the naive baseline
    // in this fixture — otherwise the >= assertion above would be vacuous.
    expect(recommendation.recommendedVersionId).not.toBe(naiveLatest.versionId);
  });

  test('insufficient sample: reports insufficient_data honestly instead of a fabricated improvement', async () => {
    evoRows = [row(1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')];
    versionKeyToValidFrom.set(1, new Date('2026-01-01T00:00:00Z'));
    evidenceByVersion.set(1, {
      sampleSize: 2,
      verifyFailureRate: 0,
      avgIterationCount: 0,
      avgExecutionTimeMs: 500,
      avgInputTokens: 50,
      avgVerifyComplexity: 1,
      confidenceScore: 0.1,
      insufficientData: true,
    });

    const recommendation = await recommendPromptVersion('implementer', 'claude-sonnet-5', 50);
    expect(recommendation.explorationMode).toBe(true);
  });
});
